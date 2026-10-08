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
import { createS3Client, ensureMediaBucket, putPublicObject } from './s3-client';

export { PUBLIC_PREFIX, UPLOAD_PREFIX } from './s3-client';

export interface PresignedUpload {
  url: string;
  headers: Record<string, string>;
  expiresInSeconds: number;
}

/**
 * Accès au stockage S3 (RustFS en développement, Cloudflare R2 en production).
 * Les envois du navigateur passent par des URL pré-signées : le fichier ne transite pas par l'API.
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly endpoint: string;
  private readonly publicUrl: string;
  private readonly autoSetup: boolean;
  private readonly corsOrigins: string[];
  /** Écart entre l'horloge du serveur S3 et celle de l'API (ms), pour signer des URL valides. */
  private clockOffsetMs = 0;

  constructor(config: ConfigService<Env, true>) {
    this.bucket = config.get('S3_BUCKET', { infer: true });
    this.endpoint = config.get('S3_ENDPOINT', { infer: true });
    this.publicUrl = config.get('S3_PUBLIC_URL', { infer: true }).replace(/\/+$/, '');
    this.autoSetup = config.get('S3_AUTO_SETUP', { infer: true });
    this.corsOrigins = config.get('CORS_ORIGINS', { infer: true });
    this.client = createS3Client({
      endpoint: this.endpoint,
      region: config.get('S3_REGION', { infer: true }),
      bucket: this.bucket,
      forcePathStyle: config.get('S3_FORCE_PATH_STYLE', { infer: true }),
      accessKeyId: config.get('S3_ACCESS_KEY_ID', { infer: true }),
      secretAccessKey: config.get('S3_SECRET_ACCESS_KEY', { infer: true }),
    });
  }

  async onModuleInit(): Promise<void> {
    await this.measureClockOffset();
    if (this.autoSetup) await this.ensureBucket();
  }

  /** URL publique d'un fichier traité. */
  publicFileUrl(key: string): string {
    return `${this.publicUrl}/${key}`;
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
        Bucket: this.bucket,
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
      const head = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return head.ContentLength ?? 0;
    } catch (error) {
      if (error instanceof NotFound || (error as { name?: string }).name === 'NotFound')
        return null;
      throw error;
    }
  }

  async download(key: string): Promise<Buffer> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    if (!response.Body) throw new Error(`Fichier vide : ${key}`);
    return Buffer.from(await response.Body.transformToByteArray());
  }

  uploadPublic(key: string, body: Buffer, contentType: string): Promise<void> {
    return putPublicObject(this.client, this.bucket, key, body, contentType);
  }

  async copy(sourceKey: string, targetKey: string): Promise<void> {
    await this.client.send(
      new CopyObjectCommand({
        Bucket: this.bucket,
        CopySource: `${this.bucket}/${sourceKey}`,
        Key: targetKey,
      }),
    );
  }

  /** Supprime des fichiers (sans erreur s'ils n'existent plus). */
  async remove(keys: readonly string[]): Promise<void> {
    for (let start = 0; start < keys.length; start += 1000) {
      const batch = keys.slice(start, start + 1000);
      if (batch.length === 0) continue;
      await this.client.send(
        new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
        }),
      );
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
      }
    } catch (error) {
      this.logger.warn(`Stockage injoignable au démarrage : ${String(error)}`);
    }
  }

  /** Développement / CI : bucket, lecture publique des photos traitées, CORS (voir s3-client.ts). */
  private async ensureBucket(): Promise<void> {
    if (await ensureMediaBucket(this.client, this.bucket, this.corsOrigins)) {
      this.logger.log(`Bucket « ${this.bucket} » créé`);
    }
  }
}
