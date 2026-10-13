/**
 * Migration ponctuelle (développement) : avant la séparation des buckets, documents privés
 * (private/) et envois bruts (tmp/) étaient dans le bucket des photos. Ce script les déplace
 * vers le bucket documents (copie, vérification de la taille, puis suppression de l'original).
 * Idempotent : relancé, il ne trouve plus rien à déplacer.
 *
 *   pnpm --filter @traiteur/api storage:split
 */
import 'dotenv/config';

import {
  CopyObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';

import {
  createS3Client,
  ensureBuckets,
  PRIVATE_PREFIX,
  UPLOAD_PREFIX,
} from '../../src/storage/s3-client';

const env = process.env;
const media = env.S3_BUCKET ?? 'traiteur-media';
const documents = env.S3_DOCUMENTS_BUCKET ?? 'traiteur-documents';
if (!env.S3_ENDPOINT || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) {
  console.error('Variables S3_ENDPOINT, S3_ACCESS_KEY_ID et S3_SECRET_ACCESS_KEY requises.');
  process.exit(1);
}
if (media === documents) {
  console.error('S3_BUCKET et S3_DOCUMENTS_BUCKET doivent être différents.');
  process.exit(1);
}

const client = createS3Client({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION ?? 'us-east-1',
  bucket: media,
  accessKeyId: env.S3_ACCESS_KEY_ID,
  secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  forcePathStyle: env.S3_FORCE_PATH_STYLE === 'true',
});

async function main(): Promise<void> {
  if (env.S3_AUTO_SETUP === 'true') {
    const origins = (env.CORS_ORIGINS ?? '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);
    await ensureBuckets(client, { media, documents }, origins);
  }
  let moved = 0;
  for (const prefix of [PRIVATE_PREFIX, UPLOAD_PREFIX]) {
    let token: string | undefined;
    do {
      const page = await client.send(
        new ListObjectsV2Command({ Bucket: media, Prefix: prefix, ContinuationToken: token }),
      );
      for (const object of page.Contents ?? []) {
        if (!object.Key) continue;
        await client.send(
          new CopyObjectCommand({
            Bucket: documents,
            CopySource: `${media}/${encodeURIComponent(object.Key).replace(/%2F/g, '/')}`,
            Key: object.Key,
          }),
        );
        const copy = await client.send(
          new HeadObjectCommand({ Bucket: documents, Key: object.Key }),
        );
        if (copy.ContentLength !== object.Size) {
          throw new Error(`Copie incomplète de ${object.Key} : original conservé`);
        }
        await client.send(new DeleteObjectCommand({ Bucket: media, Key: object.Key }));
        moved += 1;
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
  }
  console.log(`✓ ${moved} fichier(s) déplacé(s) de « ${media} » vers « ${documents} »`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
