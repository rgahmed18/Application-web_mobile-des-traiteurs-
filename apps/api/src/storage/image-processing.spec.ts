import sharp from 'sharp';

import { detectImageType, processCatalogImage } from './image-processing';

/** Photo de test 300×100 (paysage), au format demandé. */
function sampleImage(format: 'jpeg' | 'png' | 'webp'): Promise<Buffer> {
  return sharp({
    create: { width: 300, height: 100, channels: 3, background: { r: 200, g: 120, b: 60 } },
  })
    .toFormat(format)
    .toBuffer();
}

describe('detectImageType', () => {
  it.each(['jpeg', 'png', 'webp'] as const)(
    'reconnaît un fichier %s à sa signature',
    async (format) => {
      expect(detectImageType(await sampleImage(format))).toBe(format);
    },
  );

  it('refuse un fichier qui n’est pas une image, même nommé .jpg', () => {
    expect(detectImageType(Buffer.from('<?php echo "pirate"; ?>'))).toBeNull();
    expect(detectImageType(Buffer.from('%PDF-1.7'))).toBeNull();
    expect(detectImageType(Buffer.alloc(0))).toBeNull();
  });
});

describe('processCatalogImage', () => {
  it('produit des variantes WebP aux tailles prévues, sans agrandir une petite image', async () => {
    const big = await sharp({
      create: { width: 3000, height: 2000, channels: 3, background: '#c07a3c' },
    })
      .jpeg()
      .toBuffer();
    const { large, thumb } = await processCatalogImage(big);
    expect(await sharp(large).metadata()).toMatchObject({
      format: 'webp',
      width: 1200,
      height: 800,
    });
    expect(await sharp(thumb).metadata()).toMatchObject({ width: 400, height: 267 });

    const small = await processCatalogImage(await sampleImage('png'));
    expect((await sharp(small.large).metadata()).width).toBe(300);
  });

  it('applique l’orientation EXIF (photo de téléphone prise de côté)', async () => {
    // 300×100 marquée « tourner de 90° » (orientation 6) : doit devenir 100×300
    const rotated = await sharp(await sampleImage('jpeg'))
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    const { large } = await processCatalogImage(rotated);
    expect(await sharp(large).metadata()).toMatchObject({ width: 100, height: 300 });
  });

  it('supprime toutes les métadonnées, dont la position GPS', async () => {
    const withGps = await sharp(await sampleImage('jpeg'))
      .withExif({
        IFD0: { Make: 'Telephone', Model: 'Modele X', Copyright: 'Traiteur' },
        IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '33/1 35/1 0/1' },
      })
      .jpeg()
      .toBuffer();
    expect((await sharp(withGps).metadata()).exif).toBeDefined();

    const { large, thumb } = await processCatalogImage(withGps);
    for (const variant of [large, thumb]) {
      const metadata = await sharp(variant).metadata();
      expect(metadata.exif).toBeUndefined();
      expect(metadata.xmp).toBeUndefined();
      expect(metadata.iptc).toBeUndefined();
      expect(variant.includes(Buffer.from('Modele X'))).toBe(false);
    }
  });

  it('rejette un fichier corrompu', async () => {
    const truncated = (await sampleImage('jpeg')).subarray(0, 40);
    await expect(processCatalogImage(truncated)).rejects.toThrow();
  });
});
