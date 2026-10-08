import { z } from 'zod';

/**
 * Photos du catalogue.
 * Le navigateur compresse l'image (et convertit le HEIC des iPhone en JPEG), puis l'envoie
 * directement au stockage par une URL pré-signée. L'API la vérifie ensuite (type réel, taille),
 * la redimensionne, la réoriente et supprime ses métadonnées (dont la position GPS).
 */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/** Formats acceptés par l'API (le HEIC est converti en JPEG dans le navigateur). */
export const UPLOAD_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const uploadContentTypeSchema = z.enum(UPLOAD_CONTENT_TYPES);

/** Formats proposés à l'utilisateur dans le sélecteur de fichier. */
export const ACCEPTED_IMAGE_TYPES = [...UPLOAD_CONTENT_TYPES, 'image/heic', 'image/heif'] as const;

/** Tailles produites par l'API, en pixels de large (format WebP). */
export const IMAGE_VARIANTS = { large: 1200, thumb: 400 } as const;
export type ImageVariant = keyof typeof IMAGE_VARIANTS;

export const createUploadSchema = z.object({
  contentType: uploadContentTypeSchema,
  size: z.number().int().min(1).max(MAX_UPLOAD_BYTES),
});
export type CreateUploadInput = z.infer<typeof createUploadSchema>;

export const uploadTicketSchema = z.object({
  uploadId: z.uuid(),
  /** URL d'envoi (PUT), valable quelques minutes ; en-têtes à reprendre à l'identique. */
  uploadUrl: z.url(),
  headers: z.record(z.string(), z.string()),
  expiresInSeconds: z.number().int(),
});
export type UploadTicket = z.infer<typeof uploadTicketSchema>;

export const completedUploadSchema = z.object({
  uploadId: z.uuid(),
  imageKey: z.string(),
});
export type CompletedUpload = z.infer<typeof completedUploadSchema>;

/** Chemin public d'une variante : « <clé>-1200.webp ». */
export function imageVariantPath(imageKey: string, variant: ImageVariant): string {
  return `${imageKey}-${IMAGE_VARIANTS[variant]}.webp`;
}
