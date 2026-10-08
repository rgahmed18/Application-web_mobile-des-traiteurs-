/**
 * Verrouillage progressif d'un compte après des échecs de connexion consécutifs.
 *
 * Avec maxFailures = 5 et lockoutMinutes = [1, 5, 15, 60] :
 *   échecs 1 à 4 → aucun verrouillage
 *   5e échec     → 1 min
 *   6e échec     → 5 min (après la fin du précédent verrouillage)
 *   7e échec     → 15 min
 *   8e et +      → 60 min (la dernière durée s'applique ensuite)
 */
export function computeLockedUntil(
  failedCount: number,
  maxFailures: number,
  lockoutMinutes: readonly number[],
  now: Date,
): Date | null {
  if (failedCount < maxFailures || lockoutMinutes.length === 0) return null;
  const step = Math.min(failedCount - maxFailures, lockoutMinutes.length - 1);
  const minutes = lockoutMinutes[step] ?? lockoutMinutes[lockoutMinutes.length - 1] ?? 0;
  return new Date(now.getTime() + minutes * 60_000);
}

export function isLocked(lockedUntil: Date | null, now: Date): boolean {
  return lockedUntil !== null && lockedUntil > now;
}
