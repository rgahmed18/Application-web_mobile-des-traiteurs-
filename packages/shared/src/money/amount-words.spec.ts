import { describe, expect, it } from 'vitest';

import { amountToWordsAr, amountToWordsFr } from './amount-words';

const DH = (amount: number) => Math.round(amount * 100);

describe('montant en lettres — français', () => {
  it.each([
    [0, 'zéro dirham'],
    [0.5, 'cinquante centimes'],
    [0.01, 'un centime'],
    [1, 'un dirham'],
    [2, 'deux dirhams'],
    [11, 'onze dirhams'],
    [16, 'seize dirhams'],
    [17, 'dix-sept dirhams'],
    [21, 'vingt et un dirhams'],
    [71, 'soixante et onze dirhams'],
    [77, 'soixante-dix-sept dirhams'],
    [80, 'quatre-vingts dirhams'],
    [81, 'quatre-vingt-un dirhams'],
    [91, 'quatre-vingt-onze dirhams'],
    [99, 'quatre-vingt-dix-neuf dirhams'],
    [100, 'cent dirhams'],
    [101, 'cent un dirhams'],
    [200, 'deux cents dirhams'],
    [250, 'deux cent cinquante dirhams'],
    [1_000, 'mille dirhams'],
    [1_001, 'mille un dirhams'],
    [2_000, 'deux mille dirhams'],
    [80_000, 'quatre-vingt mille dirhams'],
    [200_000, 'deux cent mille dirhams'],
    [22_700, 'vingt-deux mille sept cents dirhams'],
    [1_000_000, 'un million de dirhams'],
    [2_000_000, 'deux millions de dirhams'],
    [1_500_000, 'un million cinq cent mille dirhams'],
    [200_000_000, 'deux cents millions de dirhams'],
    [80_000_000, 'quatre-vingts millions de dirhams'],
    [1_000_000_000, 'un milliard de dirhams'],
  ])('%s MAD → %s', (amount, words) => {
    expect(amountToWordsFr(DH(amount))).toBe(words);
  });

  it('dirhams et centimes', () => {
    expect(amountToWordsFr(DH(1.01))).toBe('un dirham et un centime');
    expect(amountToWordsFr(DH(22_700.5))).toBe(
      'vingt-deux mille sept cents dirhams et cinquante centimes',
    );
    expect(amountToWordsFr(DH(19_007.58))).toBe(
      'dix-neuf mille sept dirhams et cinquante-huit centimes',
    );
  });

  it('refuse un montant négatif ou non entier', () => {
    expect(() => amountToWordsFr(-1)).toThrow(RangeError);
    expect(() => amountToWordsFr(1.5)).toThrow(RangeError);
  });
});

describe('montant en lettres — arabe', () => {
  it.each([
    [0, 'صفر درهم'],
    [0.5, 'خمسون سنتيمًا'],
    [0.01, 'سنتيم واحد'],
    [0.02, 'سنتيمان'],
    [0.05, 'خمسة سنتيمات'],
    [1, 'درهم واحد'],
    [2, 'درهمان'],
    [3, 'ثلاثة دراهم'],
    [10, 'عشرة دراهم'],
    [11, 'أحد عشر درهمًا'],
    [12, 'اثنا عشر درهمًا'],
    [21, 'واحد وعشرون درهمًا'],
    [71, 'واحد وسبعون درهمًا'],
    [80, 'ثمانون درهمًا'],
    [100, 'مائة درهم'],
    [103, 'مائة وثلاثة دراهم'],
    [200, 'مائتا درهم'],
    [1_000, 'ألف درهم'],
    [2_000, 'ألفا درهم'],
    [3_000, 'ثلاثة آلاف درهم'],
    [11_000, 'أحد عشر ألف درهم'],
    [11_500, 'أحد عشر ألفًا وخمسمائة درهم'],
    [2_500, 'ألفان وخمسمائة درهم'],
    [22_700, 'اثنان وعشرون ألفًا وسبعمائة درهم'],
    [200_000, 'مائتا ألف درهم'],
    [1_000_000, 'مليون درهم'],
    [2_000_000, 'مليونا درهم'],
    [5_000_000, 'خمسة ملايين درهم'],
  ])('%s MAD → %s', (amount, words) => {
    expect(amountToWordsAr(DH(amount))).toBe(words);
  });

  it('dirhams et centimes', () => {
    expect(amountToWordsAr(DH(22_700.5))).toBe('اثنان وعشرون ألفًا وسبعمائة درهم وخمسون سنتيمًا');
    expect(amountToWordsAr(DH(1.01))).toBe('درهم واحد وسنتيم واحد');
  });
});
