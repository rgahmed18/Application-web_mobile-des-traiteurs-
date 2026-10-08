/**
 * Remplace la photo d'un plat ou d'une formule par une vraie photo.
 *
 *   pnpm --filter @traiteur/api catalog:set-photo --traiteur dar-diafa --dish pastilla-poulet --file C:/photos/pastilla.jpg
 *   pnpm --filter @traiteur/api catalog:set-photo --traiteur dar-diafa --package formule-fiancailles --file ./formule.png
 *
 * Formats : JPEG, PNG, WebP (les photos HEIC d'iPhone doivent être converties en JPEG avant,
 * ou envoyées depuis le back-office qui les convertit automatiquement). La photo est traitée
 * comme un envoi du back-office (orientation, tailles, suppression des métadonnées dont le GPS) ;
 * l'ancienne photo est supprimée automatiquement après 24 h.
 */
import 'dotenv/config';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../../src/generated/prisma/client';
import { detectImageType } from '../../src/storage/image-processing';
import { connectScriptStorage, storeAndAttachImage } from '../lib/media-script';

const USAGE =
  'Usage : catalog:set-photo --traiteur <slug> (--dish <slug> | --package <slug>) --file <chemin>';

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      traiteur: { type: 'string' },
      dish: { type: 'string' },
      package: { type: 'string' },
      file: { type: 'string' },
    },
  });
  if (!values.traiteur || !values.file || Boolean(values.dish) === Boolean(values.package)) {
    throw new Error(USAGE);
  }

  const path = resolve(values.file);
  const image = readFileSync(path);
  if (image.subarray(4, 12).toString('ascii').startsWith('ftyphei')) {
    throw new Error('Photo HEIC : convertissez-la en JPEG, ou envoyez-la depuis le back-office.');
  }
  if (!detectImageType(image)) throw new Error(`${path} n'est pas une image JPEG, PNG ou WebP.`);

  const storage = await connectScriptStorage();
  if (!storage) throw new Error('Variables S3_* manquantes (voir apps/api/.env.example).');

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL est requis');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

  try {
    const traiteur = await prisma.traiteur.findUnique({ where: { slug: values.traiteur } });
    if (!traiteur) throw new Error(`Traiteur « ${values.traiteur} » introuvable.`);

    const entityType = values.dish ? 'Dish' : 'Package';
    const slug = values.dish ?? values.package ?? '';
    const entity =
      entityType === 'Dish'
        ? await prisma.dish.findUnique({
            where: { traiteurId_slug: { traiteurId: traiteur.id, slug } },
          })
        : await prisma.package.findUnique({
            where: { traiteurId_slug: { traiteurId: traiteur.id, slug } },
          });
    if (!entity)
      throw new Error(`${entityType === 'Dish' ? 'Plat' : 'Formule'} « ${slug} » introuvable.`);

    const imageKey = await storeAndAttachImage(
      prisma,
      storage,
      traiteur.id,
      entityType,
      entity.id,
      image,
    );
    await prisma.$transaction(async (tx) => {
      if (entity.imageKey) {
        // Ancienne photo : supprimée par la tâche de nettoyage après le délai de grâce
        await tx.mediaUpload.updateMany({
          where: { imageKey: entity.imageKey, traiteurId: traiteur.id },
          data: { status: 'DETACHED', detachedAt: new Date() },
        });
      }
      if (entityType === 'Dish') {
        await tx.dish.update({ where: { id: entity.id }, data: { imageKey } });
      } else {
        await tx.package.update({ where: { id: entity.id }, data: { imageKey } });
      }
      await tx.auditLog.create({
        data: {
          traiteurId: traiteur.id,
          action: `catalog.${entityType === 'Dish' ? 'dish' : 'package'}.photo_replaced`,
          entityType,
          entityId: entity.id,
          before: { imageKey: entity.imageKey },
          after: { imageKey, source: 'script catalog:set-photo' },
        },
      });
    });
    console.log(`✓ Photo de « ${slug} » remplacée (${imageKey})`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
