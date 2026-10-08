import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketCorsCommand,
  PutBucketPolicyCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

/** Préfixe des photos traitées, lisibles publiquement (les fichiers bruts restent privés). */
export const PUBLIC_PREFIX = 'traiteurs/';
/** Fichiers bruts envoyés par le navigateur, en attente de traitement. */
export const UPLOAD_PREFIX = 'tmp/';
/** Photos traitées : nom unique par version, donc mises en cache sans limite. */
export const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';

export interface S3Settings {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

export function createS3Client(settings: S3Settings): S3Client {
  return new S3Client({
    endpoint: settings.endpoint,
    region: settings.region,
    forcePathStyle: settings.forcePathStyle,
    credentials: { accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey },
  });
}

/** Dépôt d'une variante publique (WebP, cache permanent). */
export async function putPublicObject(
  client: S3Client,
  bucket: string,
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: IMMUTABLE_CACHE,
    }),
  );
}

/**
 * Développement / CI : crée le bucket, autorise la lecture publique des seules photos traitées
 * (préfixe traiteurs/) et le CORS nécessaire à l'envoi direct depuis le navigateur.
 * En production (R2), ces réglages se font dans le tableau de bord Cloudflare.
 */
export async function ensureMediaBucket(
  client: S3Client,
  bucket: string,
  corsOrigins: readonly string[],
): Promise<boolean> {
  let created = false;
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
    created = true;
  }
  await client.send(
    new PutBucketPolicyCommand({
      Bucket: bucket,
      Policy: JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: '*',
            Action: ['s3:GetObject'],
            Resource: [`arn:aws:s3:::${bucket}/${PUBLIC_PREFIX}*`],
          },
        ],
      }),
    }),
  );
  await client.send(
    new PutBucketCorsCommand({
      Bucket: bucket,
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedOrigins: corsOrigins.length > 0 ? [...corsOrigins] : ['*'],
            AllowedMethods: ['PUT', 'GET', 'HEAD'],
            AllowedHeaders: ['*'],
            MaxAgeSeconds: 3600,
          },
        ],
      },
    }),
  );
  return created;
}
