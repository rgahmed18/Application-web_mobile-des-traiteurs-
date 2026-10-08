import { randomUUID } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import {
  type CompletedUpload,
  type CreateUploadInput,
  MAX_UPLOAD_BYTES,
  type UploadTicket,
} from '@traiteur/shared';

import { appErrors } from '../../common/errors';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService, UPLOAD_PREFIX } from '../../storage/storage.service';
import { ImageRejectedError, newImageKey, storeCatalogImage, variantKeys } from './image-store';

export { variantKeys } from './image-store';

/** Délai avant suppression d'une photo jamais rattachée ou remplacée. */
export const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;

export type MediaEntityType = 'Dish' | 'Package';

/**
 * Photos du catalogue, de l'envoi au nettoyage :
 *   1. createUpload   : URL d'envoi direct (type et taille signés), ligne MediaUpload PENDING ;
 *   2. completeUpload : vérification du type réel et de la taille, redimensionnement, suppression
 *                       des métadonnées → READY ;
 *   3. attach / detach : rattachement à un plat ou une formule, dans la transaction de l'élément ;
 *   4. cleanupOrphans : suppression des photos jamais rattachées ou remplacées depuis 24 h.
 */
@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async createUpload(traiteurId: string, input: CreateUploadInput): Promise<UploadTicket> {
    if (input.size > MAX_UPLOAD_BYTES) {
      throw appErrors.badRequest('IMAGE_TOO_LARGE', 'Image trop lourde');
    }
    const id = randomUUID();
    const rawKey = `${UPLOAD_PREFIX}${traiteurId}/${id}`;
    await this.prisma.mediaUpload.create({ data: { id, traiteurId, rawKey } });
    const presigned = await this.storage.presignUpload(rawKey, input.contentType, input.size);
    return {
      uploadId: id,
      uploadUrl: presigned.url,
      headers: presigned.headers,
      expiresInSeconds: presigned.expiresInSeconds,
    };
  }

  async completeUpload(traiteurId: string, uploadId: string): Promise<CompletedUpload> {
    const upload = await this.prisma.mediaUpload.findFirst({ where: { id: uploadId, traiteurId } });
    if (!upload) throw appErrors.notFound('UPLOAD_NOT_FOUND', 'Envoi introuvable');
    if (upload.imageKey) return { uploadId, imageKey: upload.imageKey }; // déjà traité

    const size = await this.storage.sizeOf(upload.rawKey);
    if (size === null) throw appErrors.notFound('UPLOAD_NOT_FOUND', 'Fichier non reçu');
    if (size > MAX_UPLOAD_BYTES) {
      await this.storage.remove([upload.rawKey]);
      throw appErrors.badRequest('IMAGE_TOO_LARGE', 'Image trop lourde');
    }

    const raw = await this.storage.download(upload.rawKey);
    let imageKey: string;
    try {
      imageKey = await storeCatalogImage(raw, traiteurId, (key, body, contentType) =>
        this.storage.uploadPublic(key, body, contentType),
      );
    } catch (error) {
      if (!(error instanceof ImageRejectedError)) throw error;
      await this.storage.remove([upload.rawKey]);
      throw appErrors.badRequest('IMAGE_INVALID', error.message);
    }
    await this.prisma.mediaUpload.update({
      where: { id: upload.id },
      data: { status: 'READY', imageKey },
    });
    await this.storage.remove([upload.rawKey]);
    return { uploadId, imageKey };
  }

  /**
   * Rattache une photo à un élément, dans la transaction qui l'enregistre. Une photo déjà
   * utilisée par un autre élément (duplication) est copiée : chaque photo appartient à un seul
   * élément, et remplacer celle d'un plat ne peut jamais effacer celle de sa copie.
   * Retourne la clé à enregistrer sur l'élément.
   */
  async attach(
    tx: Prisma.TransactionClient,
    traiteurId: string,
    imageKey: string,
    entityType: MediaEntityType,
    entityId: string,
  ): Promise<string> {
    const media = await tx.mediaUpload.findFirst({ where: { imageKey, traiteurId } });
    if (!media || media.status === 'PENDING') {
      throw appErrors.badRequest('IMAGE_INVALID', 'Photo inconnue');
    }
    if (media.status === 'ATTACHED' && media.entityId === entityId) return imageKey;

    if (media.status === 'ATTACHED') {
      // La copie est enregistrée hors transaction (READY) avant de copier les fichiers : si la
      // transaction échoue ensuite, le nettoyage des 24 h la supprime (aucun fichier sans suivi).
      const copyKey = newImageKey(traiteurId);
      const copy = await this.prisma.mediaUpload.create({
        data: {
          traiteurId,
          rawKey: `${UPLOAD_PREFIX}${traiteurId}/copy-${randomUUID()}`,
          imageKey: copyKey,
          status: 'READY',
        },
      });
      const targets = variantKeys(copyKey);
      await Promise.all(
        variantKeys(imageKey).map((source, index) =>
          this.storage.copy(source, targets[index] ?? source),
        ),
      );
      await tx.mediaUpload.update({
        where: { id: copy.id },
        data: { status: 'ATTACHED', entityType, entityId },
      });
      return copyKey;
    }

    await tx.mediaUpload.update({
      where: { id: media.id },
      data: { status: 'ATTACHED', entityType, entityId, detachedAt: null },
    });
    return imageKey;
  }

  /** Photo remplacée ou élément supprimé : effacée après le délai de grâce (annulation possible). */
  async detach(tx: Prisma.TransactionClient, traiteurId: string, imageKey: string): Promise<void> {
    await tx.mediaUpload.updateMany({
      where: { imageKey, traiteurId, status: 'ATTACHED' },
      data: { status: 'DETACHED', detachedAt: new Date() },
    });
  }

  /** Supprime les photos jamais rattachées ou détachées depuis plus de 24 h. */
  async cleanupOrphans(now = new Date()): Promise<number> {
    const threshold = new Date(now.getTime() - ORPHAN_GRACE_MS);
    let removed = 0;
    for (;;) {
      const batch = await this.prisma.mediaUpload.findMany({
        where: {
          OR: [
            { status: { in: ['PENDING', 'READY'] }, createdAt: { lt: threshold } },
            { status: 'DETACHED', detachedAt: { lt: threshold } },
          ],
        },
        take: 200,
      });
      if (batch.length === 0) break;

      const keys = batch.flatMap((media) => [
        media.rawKey,
        ...(media.imageKey ? variantKeys(media.imageKey) : []),
      ]);
      await this.storage.remove(keys);
      await this.prisma.mediaUpload.deleteMany({ where: { id: { in: batch.map((m) => m.id) } } });
      removed += batch.length;
    }
    if (removed > 0) this.logger.log(`${removed} photo(s) orpheline(s) supprimée(s)`);
    return removed;
  }
}
