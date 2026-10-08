import { computeLockedUntil, isLocked } from './login-lockout';

const NOW = new Date('2026-10-08T12:00:00Z');
const STEPS = [1, 5, 15, 60];
const minutesAfterNow = (date: Date | null) =>
  date === null ? null : (date.getTime() - NOW.getTime()) / 60_000;

describe('computeLockedUntil', () => {
  it('ne verrouille pas avant le seuil', () => {
    for (let failures = 0; failures < 5; failures += 1) {
      expect(computeLockedUntil(failures, 5, STEPS, NOW)).toBeNull();
    }
  });

  it('verrouille progressivement : 1, 5, 15 puis 60 min', () => {
    expect(minutesAfterNow(computeLockedUntil(5, 5, STEPS, NOW))).toBe(1);
    expect(minutesAfterNow(computeLockedUntil(6, 5, STEPS, NOW))).toBe(5);
    expect(minutesAfterNow(computeLockedUntil(7, 5, STEPS, NOW))).toBe(15);
    expect(minutesAfterNow(computeLockedUntil(8, 5, STEPS, NOW))).toBe(60);
  });

  it('applique la dernière durée au-delà de la liste', () => {
    expect(minutesAfterNow(computeLockedUntil(42, 5, STEPS, NOW))).toBe(60);
  });
});

describe('isLocked', () => {
  it('est verrouillé tant que la date de fin n’est pas passée', () => {
    expect(isLocked(new Date(NOW.getTime() + 1), NOW)).toBe(true);
    expect(isLocked(new Date(NOW.getTime() - 1), NOW)).toBe(false);
    expect(isLocked(null, NOW)).toBe(false);
  });
});
