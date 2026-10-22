'use client';

import { useSession } from '@/features/auth/session-provider';

/** Initiales d'un nom (« Dar Diafa Traiteur » → « DD »). */
export function initialsOf(name: string): string {
  const words = name
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter((word) => word.length > 0);
  return (
    words
      .slice(0, 2)
      .map((word) => word.charAt(0).toUpperCase())
      .join('') || '•'
  );
}

/**
 * Marque blanche du back-office : nom et logo du traiteur (initiales sans logo). « Gestion
 * Traiteurs » reste réservé à la console de la plateforme.
 */
export function TraiteurBrand() {
  const { traiteur } = useSession();
  const name = traiteur?.name ?? '';
  return (
    <div className="flex min-w-0 items-center gap-3" data-testid="traiteur-brand">
      {traiteur?.logoUrl ? (
        // Logo servi par le stockage (lien signé) : pas d'optimisation Next nécessaire
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={traiteur.logoUrl}
          alt=""
          className="size-10 shrink-0 rounded-lg bg-white object-contain p-0.5"
        />
      ) : (
        <span
          className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground"
          aria-hidden
        >
          {initialsOf(name)}
        </span>
      )}
      <span className="truncate text-lg font-semibold" dir="auto">
        {name}
      </span>
    </div>
  );
}
