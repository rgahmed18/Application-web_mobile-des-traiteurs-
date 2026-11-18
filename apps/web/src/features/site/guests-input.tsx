'use client';

import { MinusIcon, PlusIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

import { cartStore, useGuests } from './cart-store';
import { GUESTS_MAX, GUESTS_MIN, parseGuests } from './guests';

/** Pas des boutons − / + (le nombre exact se saisit au clavier). */
const STEP = 10;

/**
 * « Nombre d'invités » de la demande : saisie exacte (clavier numérique sur téléphone), boutons
 * − / +, vide au départ (« Ex. : 150 »). Entier de 1 à 5 000 ; une saisie invalide est signalée
 * et n'est pas retenue. Le nombre est partagé par tout le site (comparateur, fiches, « Ma
 * demande ») et envoyé avec la demande.
 */
export function GuestsInput({ className }: { className?: string }) {
  const t = useTranslations('site.guests');
  const id = useId();
  const guests = useGuests();
  // Saisie en cours tant qu'elle n'est pas un nombre valide (sinon : nombre partagé)
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? (guests === null ? '' : String(guests));
  const { error } = parseGuests(text);

  const change = (next: string) => {
    const parsed = parseGuests(next);
    if (parsed.error) {
      setDraft(next);
      return;
    }
    setDraft(null);
    cartStore.setGuests(parsed.value);
  };
  const step = (delta: number) => {
    setDraft(null);
    cartStore.setGuests((guests ?? 0) + delta);
  };

  return (
    <div className={cn('flex flex-col gap-1.5', className)} data-testid="guests-input">
      <label htmlFor={id} className="text-sm font-bold">
        {t('label')}
      </label>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-11 shrink-0 rounded-full"
          onClick={() => step(-STEP)}
          disabled={guests === null || guests <= GUESTS_MIN}
          aria-label={t('less', { step: STEP })}
          data-testid="guests-less"
        >
          <MinusIcon />
        </Button>
        <Input
          id={id}
          value={text}
          onChange={(event) => change(event.target.value)}
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          placeholder={t('placeholder')}
          dir="ltr"
          className="h-11 w-32 text-center text-lg font-bold"
          aria-invalid={error !== null}
          aria-describedby={error ? `${id}-error` : undefined}
          data-testid="guests-field"
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-11 shrink-0 rounded-full"
          onClick={() => step(STEP)}
          disabled={guests !== null && guests >= GUESTS_MAX}
          aria-label={t('more', { step: STEP })}
          data-testid="guests-more"
        >
          <PlusIcon />
        </Button>
      </div>
      {error && (
        <p
          id={`${id}-error`}
          role="alert"
          className="text-sm text-destructive"
          data-testid="guests-error"
        >
          {t(error, { min: GUESTS_MIN, max: GUESTS_MAX })}
        </p>
      )}
    </div>
  );
}
