import { randomUUID } from 'node:crypto';

import { HeadObjectCommand, ListObjectsV2Command, type S3Client } from '@aws-sdk/client-s3';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';

import { AppConfigModule } from '../../src/config/app-config.module';
import type { Env } from '../../src/config/env.schema';
import {
  bucketForKey,
  createS3Client,
  PRIVATE_PREFIX,
  PUBLIC_PREFIX,
  UPLOAD_PREFIX,
} from '../../src/storage/s3-client';
import { StorageService } from '../../src/storage/storage.service';

/**
 * Aucun document privé (factures, reçus, devis, photos de chèques, pièces jointes) ni envoi
 * brut (photo d'origine, avec ses métadonnées) n'est jamais servi par l'URL publique : ils ne
 * sont même pas dans le bucket public, qui ne contient que des photos traitées.
 */
describe('Isolation du stockage public', () => {
  let storage: StorageService;
  let client: S3Client;
  let media: string;
  let documents: string;
  let publicUrl: string;
  const run = randomUUID();
  const privateKey = `${PRIVATE_PREFIX}traiteurs/test-${run}/receipts/REC-TEST.pdf`;
  const uploadKey = `${UPLOAD_PREFIX}test-${run}/raw-photo`;
  const publicKey = `${PUBLIC_PREFIX}test-${run}/dishes/photo-480.webp`;

  /** Lecture anonyme par l'URL publique, comme le ferait n'importe quel internaute. */
  const anonymous = async (key: string) => (await fetch(`${publicUrl}/${key}`)).status;

  const existsIn = async (bucket: string, key: string) => {
    try {
      await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule],
      providers: [StorageService],
    }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    storage = app.get(StorageService);
    const config: ConfigService<Env, true> = app.get(ConfigService);
    media = config.get('S3_BUCKET', { infer: true });
    documents = config.get('S3_DOCUMENTS_BUCKET', { infer: true });
    publicUrl = config.get('S3_PUBLIC_URL', { infer: true }).replace(/\/+$/, '');
    client = createS3Client({
      endpoint: config.get('S3_ENDPOINT', { infer: true }),
      region: config.get('S3_REGION', { infer: true }),
      bucket: media,
      accessKeyId: config.get('S3_ACCESS_KEY_ID', { infer: true }),
      secretAccessKey: config.get('S3_SECRET_ACCESS_KEY', { infer: true }),
      forcePathStyle: config.get('S3_FORCE_PATH_STYLE', { infer: true }),
    });

    await storage.putPrivate(privateKey, Buffer.from('%PDF-1.7 test'), 'application/pdf');
    const upload = await storage.presignUpload(uploadKey, 'image/jpeg', 4);
    const put = await fetch(upload.url, {
      method: 'PUT',
      headers: upload.headers,
      body: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
    });
    expect(put.status).toBe(200);
    await storage.uploadPublic(publicKey, Buffer.from('RIFF'), 'image/webp');
  });

  afterAll(async () => {
    await storage.remove([privateKey, uploadKey, publicKey]);
  });

  it('chaque clé va dans son bucket : seules les photos traitées sont publiques', () => {
    expect(media).not.toBe(documents);
    const buckets = { media, documents };
    expect(bucketForKey(buckets, publicKey)).toBe(media);
    expect(bucketForKey(buckets, privateKey)).toBe(documents);
    expect(bucketForKey(buckets, uploadKey)).toBe(documents);
    // Une clé inattendue (préfixe inconnu) reste privée par défaut
    expect(bucketForKey(buckets, 'autre/fichier.pdf')).toBe(documents);
  });

  it('refuse de produire une URL publique ou un dépôt public pour un document', async () => {
    expect(() => storage.publicFileUrl(privateKey)).toThrow();
    expect(() => storage.publicFileUrl(uploadKey)).toThrow();
    expect(storage.publicFileUrl(publicKey)).toBe(`${publicUrl}/${publicKey}`);
    await expect(
      storage.uploadPublic(privateKey, Buffer.from('x'), 'application/pdf'),
    ).rejects.toThrow();
    await expect(storage.putPrivate(publicKey, Buffer.from('x'), 'image/webp')).rejects.toThrow();
  });

  it('un document ou un envoi brut n’est jamais lisible par l’URL publique', async () => {
    expect(await anonymous(publicKey)).toBe(200);
    expect(await anonymous(privateKey)).not.toBe(200);
    expect(await anonymous(uploadKey)).not.toBe(200);
    // Ils ne sont même pas dans le bucket public
    expect(await existsIn(media, privateKey)).toBe(false);
    expect(await existsIn(media, uploadKey)).toBe(false);
    expect(await existsIn(documents, privateKey)).toBe(true);
    // Lisibles uniquement par URL signée
    const signed = await storage.signedDownloadUrl(privateKey, 'REC-TEST.pdf');
    expect((await fetch(signed)).status).toBe(200);
  });

  it('le bucket public ne contient que des photos traitées', async () => {
    const offending: string[] = [];
    let token: string | undefined;
    do {
      const page = await client.send(
        new ListObjectsV2Command({ Bucket: media, ContinuationToken: token }),
      );
      for (const object of page.Contents ?? []) {
        if (object.Key && !object.Key.startsWith(PUBLIC_PREFIX)) offending.push(object.Key);
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    expect(offending).toEqual([]);
  });
});
