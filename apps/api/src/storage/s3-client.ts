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
/** Documents (PDF, pièces jointes) : jamais lisibles publiquement, téléchargés par URL signée. */
export const PRIVATE_PREFIX = 'private/';
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

export interface BucketNames {
  /** Photos traitées (préfixe traiteurs/), lisibles publiquement. */
  media: string;
  /** Documents privés (private/) et envois bruts (tmp/) : jamais publics, URL signées. */
  documents: string;
}

/** Bucket d'une clé : seules les photos traitées vont dans le bucket public. */
export function bucketForKey(buckets: BucketNames, key: string): string {
  return key.startsWith(PUBLIC_PREFIX) ? buckets.media : buckets.documents;
}

async function ensureBucket(client: S3Client, bucket: string): Promise<boolean> {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    return false;
  } catch {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
    return true;
  }
}

/**
 * Développement / CI (S3_AUTO_SETUP) : crée les deux buckets. Bucket media : lecture publique
 * des photos traitées. Bucket documents : aucune lecture publique ; CORS pour l'envoi direct
 * depuis le navigateur (tmp/). En production (Cloudflare R2), même découpage, configuré dans le
 * tableau de bord : seul le bucket media a un domaine public (R2 ne connaît pas les règles par
 * préfixe, d'où deux buckets). Retourne les buckets créés.
 */
export async function ensureBuckets(
  client: S3Client,
  buckets: BucketNames,
  corsOrigins: readonly string[],
): Promise<string[]> {
  const created: string[] = [];
  for (const bucket of [buckets.media, buckets.documents]) {
    if (await ensureBucket(client, bucket)) created.push(bucket);
  }
  await client.send(
    new PutBucketPolicyCommand({
      Bucket: buckets.media,
      Policy: JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: '*',
            Action: ['s3:GetObject'],
            Resource: [`arn:aws:s3:::${buckets.media}/${PUBLIC_PREFIX}*`],
          },
        ],
      }),
    }),
  );
  await client.send(
    new PutBucketCorsCommand({
      Bucket: buckets.documents,
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
