import { IMAGE_VARIANTS, type ImageVariant } from '@traiteur/shared';
import sharp from 'sharp';

/** Formats d'image reconnus à leur signature binaire (et non à l'extension ou au type déclaré). */
export type DetectedImageType = 'jpeg' | 'png' | 'webp';

/** Identifie le format réel d'un fichier à partir de ses premiers octets. */
export function detectImageType(buffer: Buffer): DetectedImageType | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpeg';
  }
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'png';
  }
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'webp';
  }
  return null;
}

/** Image trop grande pour être décodée sans risque (protection mémoire : 50 mégapixels). */
const MAX_INPUT_PIXELS = 50_000_000;

export type ProcessedImage = Record<ImageVariant, Buffer>;

/**
 * Prépare une photo du catalogue :
 *   - orientation corrigée selon l'EXIF (photo de téléphone prise de côté) ;
 *   - redimensionnée sans agrandissement, en WebP, à chaque taille de IMAGE_VARIANTS ;
 *   - toutes les métadonnées supprimées (EXIF, position GPS, modèle de téléphone...) :
 *     sharp ne les recopie jamais sans appel explicite à withMetadata / keepExif.
 */
export async function processCatalogImage(input: Buffer): Promise<ProcessedImage> {
  const source = sharp(input, { failOn: 'error', limitInputPixels: MAX_INPUT_PIXELS })
    .rotate()
    .flatten({ background: '#ffffff' }); // transparence PNG → fond blanc

  const entries = await Promise.all(
    (Object.entries(IMAGE_VARIANTS) as [ImageVariant, number][]).map(async ([variant, width]) => {
      const buffer = await source
        .clone()
        .resize({ width, height: width, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82, effort: 4 })
        .toBuffer();
      return [variant, buffer] as const;
    }),
  );
  return Object.fromEntries(entries) as ProcessedImage;
}
