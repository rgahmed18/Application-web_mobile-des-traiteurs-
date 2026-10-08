import { MAX_UPLOAD_BYTES } from '@traiteur/shared';

/**
 * Préparation d'une photo dans le navigateur, avant l'envoi :
 *   - HEIC / HEIF (iPhone) : décodé nativement si le navigateur le sait (Safari), sinon par
 *     heic-to, chargé uniquement à ce moment-là (bibliothèque lourde, LGPL) ;
 *   - orientation EXIF appliquée (photo prise de côté) ;
 *   - réduite à 2560 px au plus et compressée en JPEG : une photo de téléphone de 8 Mo passe
 *     sous 1 Mo, l'envoi reste rapide en 4G ;
 *   - ré-encodée : aucune métadonnée (position GPS, modèle du téléphone) ne quitte l'appareil.
 * L'API refait ces contrôles de son côté : cette étape sert la rapidité, pas la sécurité.
 */
const MAX_DIMENSION = 2560;
const FALLBACK_DIMENSION = 1920;
const HEIC_TYPES = new Set([
  'image/heic',
  'image/heif',
  'image/heic-sequence',
  'image/heif-sequence',
]);
const STANDARD_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export class UnsupportedImageError extends Error {
  constructor() {
    super('Format de photo non pris en charge');
    this.name = 'UnsupportedImageError';
  }
}

/** Le type peut être vide pour un HEIC selon le navigateur : l'extension sert alors d'indice. */
export function isHeicFile(file: Pick<File, 'type' | 'name'>): boolean {
  return HEIC_TYPES.has(file.type.toLowerCase()) || /\.(heic|heif)$/i.test(file.name);
}

export function isAcceptedImageFile(file: Pick<File, 'type' | 'name'>): boolean {
  return STANDARD_TYPES.has(file.type.toLowerCase()) || isHeicFile(file);
}

/** Dimensions réduites proportionnellement pour tenir dans un carré de `max` pixels. */
export function fitWithin(
  width: number,
  height: number,
  max: number,
): { width: number; height: number } {
  if (width <= max && height <= max) return { width, height };
  const ratio = Math.min(max / width, max / height);
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}

async function decode(file: File): Promise<ImageBitmap> {
  try {
    // imageOrientation 'from-image' : applique l'orientation EXIF
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    if (!isHeicFile(file)) throw new UnsupportedImageError();
    const { heicTo } = await import('heic-to');
    return heicTo({ blob: file, type: 'bitmap', options: { imageOrientation: 'from-image' } });
  }
}

function encode(bitmap: ImageBitmap, maxDimension: number, quality: number): Promise<Blob> {
  const { width, height } = fitWithin(bitmap.width, bitmap.height, maxDimension);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new UnsupportedImageError();
  // Fond blanc : une image PNG transparente ne devient pas noire en JPEG
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.drawImage(bitmap, 0, 0, width, height);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new UnsupportedImageError())),
      'image/jpeg',
      quality,
    );
  });
}

/** Photo prête à l'envoi (JPEG, sans métadonnées, sous la limite de taille). */
export async function prepareImageForUpload(file: File): Promise<Blob> {
  if (!isAcceptedImageFile(file)) throw new UnsupportedImageError();
  const bitmap = await decode(file);
  try {
    let blob = await encode(bitmap, MAX_DIMENSION, 0.85);
    if (blob.size > MAX_UPLOAD_BYTES) blob = await encode(bitmap, FALLBACK_DIMENSION, 0.75);
    if (blob.size > MAX_UPLOAD_BYTES) blob = await encode(bitmap, FALLBACK_DIMENSION, 0.6);
    return blob;
  } finally {
    bitmap.close();
  }
}
