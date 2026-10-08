import { randomUUID } from 'node:crypto';

import { IMAGE_VARIANTS, imageVariantPath, type ImageVariant } from '@traiteur/shared';

import { detectImageType, processCatalogImage } from '../../storage/image-processing';
import { PUBLIC_PREFIX } from '../../storage/s3-client';

const VARIANTS = Object.keys(IMAGE_VARIANTS) as ImageVariant[];

/** Fichier refusé : pas une image reconnue, ou image illisible / corrompue. */
export class ImageRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageRejectedError';
  }
}

/** Nouvelle clé de photo pour un traiteur : traiteurs/<id>/catalog/<uuid>. */
export function newImageKey(traiteurId: string): string {
  return `${PUBLIC_PREFIX}${traiteurId}/catalog/${randomUUID()}`;
}

/** Tous les fichiers d'une photo traitée (une variante par taille). */
export function variantKeys(imageKey: string): string[] {
  return VARIANTS.map((variant) => imageVariantPath(imageKey, variant));
}

/**
 * Vérifie le format réel d'une image, la traite (orientation, tailles, métadonnées supprimées)
 * et dépose ses variantes WebP. Partagé par l'API (envois du back-office) et les scripts
 * (seed, remplacement d'une photo). Retourne la clé de la photo.
 */
export async function storeCatalogImage(
  raw: Buffer,
  traiteurId: string,
  putPublic: (key: string, body: Buffer, contentType: string) => Promise<void>,
): Promise<string> {
  if (!detectImageType(raw))
    throw new ImageRejectedError("Le fichier n'est pas une image JPEG, PNG ou WebP");
  let variants: Awaited<ReturnType<typeof processCatalogImage>>;
  try {
    variants = await processCatalogImage(raw);
  } catch {
    throw new ImageRejectedError('Image illisible ou corrompue');
  }
  const imageKey = newImageKey(traiteurId);
  await Promise.all(
    VARIANTS.map((variant) =>
      putPublic(imageVariantPath(imageKey, variant), variants[variant], 'image/webp'),
    ),
  );
  return imageKey;
}
