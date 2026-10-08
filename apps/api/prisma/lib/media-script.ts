/**
 * Photos du catalogue depuis un script (seed, remplacement par une vraie photo) : même
 * traitement que les envois du back-office (vérification du format, orientation, tailles,
 * métadonnées supprimées), même suivi (MediaUpload) pour le nettoyage des anciennes photos.
 */
import { randomUUID } from 'node:crypto';

import type { S3Client } from '@aws-sdk/client-s3';
import { z } from 'zod';

import { storeCatalogImage } from '../../src/catalog/media/image-store';
import type { PrismaClient } from '../../src/generated/prisma/client';
import {
  createS3Client,
  ensureMediaBucket,
  putPublicObject,
  UPLOAD_PREFIX,
} from '../../src/storage/s3-client';

const scriptEnvSchema = z.object({
  S3_ENDPOINT: z.url(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().default('traiteur-media'),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: z.enum(['true', 'false']).default('false'),
  S3_AUTO_SETUP: z.enum(['true', 'false']).default('false'),
  CORS_ORIGINS: z.string().default(''),
});

export interface ScriptStorage {
  client: S3Client;
  bucket: string;
}

/** Stockage configuré par les variables S3_* ; null (avec message) si elles sont absentes. */
export async function connectScriptStorage(): Promise<ScriptStorage | null> {
  const parsed = scriptEnvSchema.safeParse(process.env);
  if (!parsed.success) return null;
  const env = parsed.data;
  const client = createS3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    bucket: env.S3_BUCKET,
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    forcePathStyle: env.S3_FORCE_PATH_STYLE === 'true',
  });
  if (env.S3_AUTO_SETUP === 'true') {
    const origins = env.CORS_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);
    await ensureMediaBucket(client, env.S3_BUCKET, origins);
  }
  return { client, bucket: env.S3_BUCKET };
}

/**
 * Traite et dépose une image, puis la rattache à l'élément (MediaUpload ATTACHED).
 * Retourne la clé à enregistrer sur le plat ou la formule.
 */
export async function storeAndAttachImage(
  prisma: PrismaClient,
  storage: ScriptStorage,
  traiteurId: string,
  entityType: 'Dish' | 'Package',
  entityId: string,
  image: Buffer,
): Promise<string> {
  const imageKey = await storeCatalogImage(image, traiteurId, (key, body, contentType) =>
    putPublicObject(storage.client, storage.bucket, key, body, contentType),
  );
  await prisma.mediaUpload.create({
    data: {
      traiteurId,
      rawKey: `${UPLOAD_PREFIX}${traiteurId}/script-${randomUUID()}`,
      imageKey,
      status: 'ATTACHED',
      entityType,
      entityId,
    },
  });
  return imageKey;
}
