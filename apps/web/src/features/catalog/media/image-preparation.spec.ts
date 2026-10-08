import { describe, expect, it } from 'vitest';

import { fitWithin, isAcceptedImageFile, isHeicFile } from './image-preparation';

describe('fitWithin', () => {
  it('garde une image déjà assez petite', () => {
    expect(fitWithin(1200, 800, 2560)).toEqual({ width: 1200, height: 800 });
  });

  it('réduit proportionnellement une photo de téléphone (paysage et portrait)', () => {
    expect(fitWithin(4032, 3024, 2560)).toEqual({ width: 2560, height: 1920 });
    expect(fitWithin(3024, 4032, 2560)).toEqual({ width: 1920, height: 2560 });
  });
});

describe('types de fichiers', () => {
  it('accepte JPEG, PNG, WebP et HEIC', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']) {
      expect(isAcceptedImageFile({ type, name: 'photo' })).toBe(true);
    }
  });

  it('reconnaît un HEIC sans type déclaré grâce à son extension', () => {
    expect(isHeicFile({ type: '', name: 'IMG_0042.HEIC' })).toBe(true);
    expect(isAcceptedImageFile({ type: '', name: 'IMG_0042.heic' })).toBe(true);
  });

  it('refuse les autres fichiers', () => {
    expect(isAcceptedImageFile({ type: 'application/pdf', name: 'menu.pdf' })).toBe(false);
    expect(isAcceptedImageFile({ type: 'image/gif', name: 'anim.gif' })).toBe(false);
    expect(isAcceptedImageFile({ type: '', name: 'photo.jpg.exe' })).toBe(false);
  });
});
