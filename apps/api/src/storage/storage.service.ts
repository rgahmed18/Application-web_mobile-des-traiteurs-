import {
  CopyObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../config/env.schema';
import {
  type BucketNames,
  bucketForKey,
  createS3Client,
  ensureBuckets,
  PRIVATE_PREFIX,
  PUBLIC_PREFIX,
  putPublicObject,
} from './s3-client';

export { PRIVATE_PREFIX, PUBLIC_PREFIX, UPLOAD_PREFIX } from './s3-client';

export interface PresignedUpload {
  url: string;
  headers: Record<string, string>;
  expiresInSeconds: number;
}

/**
 * Accès au stockage S3 (RustFS en développement, Cloudflare R2 en production).
 * Les envois du navigateur passent par des URL pré-signées : le fichier ne transite pas par l'API.
 *
 * Deux buckets, choisis par le préfixe de la clé (bucketForKey) : `media` (S3_BUCKET, public)
 * ne reçoit que les photos traitées (traiteurs/) ; `documents` (S3_DOCUMENTS_BUCKET, privé)
 * reçoit les documents (private/) et les envois bruts (tmp/), lus par URL signée uniquement.
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client;
  private readonly buckets: BucketNames;
  private readonly endpoint: string;
  private readonly publicUrl: string;
  private readonly autoSetup: boolean;
  private readonly corsOrigins: string[];
  /** Écart entre l'horloge du serveur S3 et celle de l'API (ms), pour signer des URL valides. */
  private clockOffsetMs = 0;

  constructor(config: ConfigService<Env, true>) {
    this.buckets = {
      media: config.get('S3_BUCKET', { infer: true }),
      documents: config.get('S3_DOCUMENTS_BUCKET', { infer: true }),
    };
    this.endpoint = config.get('S3_ENDPOINT', { infer: true });
    this.publicUrl = config.get('S3_PUBLIC_URL', { infer: true }).replace(/\/+$/, '');
    this.autoSetup = config.get('S3_AUTO_SETUP', { infer: true });
    this.corsOrigins = config.get('CORS_ORIGINS', { infer: true });
    this.client = createS3Client({
      endpoint: this.endpoint,
      region: config.get('S3_REGION', { infer: true }),
      bucket: this.buckets.media,
      forcePathStyle: config.get('S3_FORCE_PATH_STYLE', { infer: true }),
      accessKeyId: config.get('S3_ACCESS_KEY_ID', { infer: true }),
      secretAccessKey: config.get('S3_SECRET_ACCESS_KEY', { infer: true }),
    });
  }

  async onModuleInit(): Promise<void> {
    await this.measureClockOffset();
    if (this.autoSetup) await this.ensureBucket();
  }

  /** URL publique d'une photo traitée ; jamais pour un document ou un envoi brut. */
  publicFileUrl(key: string): string {
    if (!key.startsWith(PUBLIC_PREFIX)) throw new Error(`Clé non publique : ${key}`);
    return `${this.publicUrl}/${key}`;
  }

  /** Bucket où vit une clé (photos traitées : media ; tout le reste : documents). */
  bucketOf(key: string): string {
    return bucketForKey(this.buckets, key);
  }

  /**
   * URL d'envoi direct depuis le navigateur. Le type et la taille exacte sont signés :
   * le stockage refuse un fichier plus gros que celui annoncé (et donc vérifié).
   */
  async presignUpload(
    key: string,
    contentType: string,
    size: number,
    expiresInSeconds = 300,
  ): Promise<PresignedUpload> {
    const url = await getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.bucketOf(key),
        Key: key,
        ContentType: contentType,
        ContentLength: size,
      }),
      {
        expiresIn: expiresInSeconds,
        signingDate: new Date(Date.now() + this.clockOffsetMs),
        signableHeaders: new Set(['content-type', 'content-length']),
      },
    );
    return { url, headers: { 'Content-Type': contentType }, expiresInSeconds };
  }

  /** Taille d'un fichier, ou null s'il n'existe pas. */
  async sizeOf(key: string): Promise<number | null> {
    try {
      const head = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucketOf(key), Key: key }),
      );
      return head.ContentLength ?? 0;
    } catch (error) {
      if (error instanceof NotFound || (error as { name?: string }).name === 'NotFound')
        return null;
      throw error;
    }
  }

  async download(key: string): Promise<Buffer> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucketOf(key), Key: key }),
    );
    if (!response.Body) throw new Error(`Fichier vide : ${key}`);
    return Buffer.from(await response.Body.transformToByteArray());
  }

  /** Dépôt d'une photo traitée (préfixe traiteurs/, bucket public). */
  async uploadPublic(key: string, body: Buffer, contentType: string): Promise<void> {
    if (!key.startsWith(PUBLIC_PREFIX)) throw new Error(`Clé publique attendue : ${key}`);
    await putPublicObject(this.client, this.buckets.media, key, body, contentType);
  }

  /** Dépôt d'un document privé (préfixe private/, jamais public). */
  async putPrivate(key: string, body: Buffer, contentType: string): Promise<void> {
    if (!key.startsWith(PRIVATE_PREFIX)) throw new Error(`Clé privée attendue : ${key}`);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.buckets.documents,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  /** URL de téléchargement signée, valable quelques minutes, avec le nom de fichier proposé. */
  async signedDownloadUrl(key: string, fileName: string, expiresInSeconds = 300): Promise<string> {
    const encoded = encodeURIComponent(fileName);
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucketOf(key),
        Key: key,
        ResponseContentDisposition: `inline; filename="${fileName.replace(/[^ -~]/g, '_')}"; filename*=UTF-8''${encoded}`,
      }),
      { expiresIn: expiresInSeconds, signingDate: new Date(Date.now() + this.clockOffsetMs) },
    );
  }

  async copy(sourceKey: string, targetKey: string): Promise<void> {
    await this.client.send(
      new CopyObjectCommand({
        Bucket: this.bucketOf(targetKey),
        CopySource: `${this.bucketOf(sourceKey)}/${sourceKey}`,
        Key: targetKey,
      }),
    );
  }

  /** Supprime des fichiers (sans erreur s'ils n'existent plus). */
  async remove(keys: readonly string[]): Promise<void> {
    for (const bucket of [this.buckets.media, this.buckets.documents]) {
      const own = keys.filter((key) => this.bucketOf(key) === bucket);
      for (let start = 0; start < own.length; start += 1000) {
        const batch = own.slice(start, start + 1000);
        await this.client.send(
          new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
          }),
        );
      }
    }
  }

  /**
   * Mesure l'écart d'horloge avec le serveur S3 (en-tête Date). Une horloge locale décalée
   * produirait des URL pré-signées « expirées » dès leur création.
   */
  private async measureClockOffset(): Promise<void> {
    try {
      const response = await fetch(this.endpoint, { method: 'HEAD' });
      const serverDate = response.headers.get('date');
      if (!serverDate) return;
      const offset = new Date(serverDate).getTime() - Date.now();
      if (Math.abs(offset) > 60_000) {
        this.logger.warn(
          `Horloge locale décalée de ${Math.round(offset / 1000)} s par rapport au stockage : ` +
            'les URL d’envoi sont signées avec l’heure du stockage. Synchronisez l’heure du serveur.',
        );
        this.clockOffsetMs = offset;
        // Requêtes signées par le SDK (dépôts, copies) : même correction, sans attendre un refus
        this.client.config.systemClockOffset = offset;
      }
    } catch (error) {
      this.logger.warn(`Stockage injoignable au démarrage : ${String(error)}`);
    }
  }

  /** Développement / CI : buckets media et documents, lecture publique, CORS (s3-client.ts). */
  private async ensureBucket(): Promise<void> {
    for (const bucket of await ensureBuckets(this.client, this.buckets, this.corsOrigins)) {
      this.logger.log(`Bucket « ${bucket} » créé`);
    }
  }
}
