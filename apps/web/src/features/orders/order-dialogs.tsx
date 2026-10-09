'use client';

import { type Availability, availabilitySchema } from '@traiteur/shared';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FieldError } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import { isApiError } from '@/lib/api/errors';
import { formatDateTime, formatLocalDate } from '@/lib/format/date';

// ─────────────────────────── Erreurs 409 de l'API ───────────────────────────

/** Jour indisponible (date bloquée, capacité atteinte) renvoyé par l'API : le traiteur peut forcer. */
export function availabilityConflict(error: unknown): Availability | null {
  if (!isApiError(error) || error.code !== 'AVAILABILITY_CONFLICT') return null;
  const parsed = availabilitySchema.safeParse(error.details.availability);
  return parsed.success ? parsed.data : null;
}

export interface VersionConflict {
  modifiedBy: string | null;
  modifiedAt: string | null;
}

/** Commande modifiée entre-temps par quelqu'un d'autre (verrouillage optimiste). */
export function versionConflict(error: unknown): VersionConflict | null {
  if (!isApiError(error) || error.code !== 'ORDER_VERSION_CONFLICT') return null;
  const { modifiedBy, modifiedAt } = error.details;
  return {
    modifiedBy: typeof modifiedBy === 'string' ? modifiedBy : null,
    modifiedAt: typeof modifiedAt === 'string' ? modifiedAt : null,
  };
}

export const isReasonRequired = (error: unknown) =>
  isApiError(error) && error.code === 'REASON_REQUIRED';

// ─────────────────────────── Fenêtres ───────────────────────────

/** Confirmer malgré une date bloquée ou une capacité atteinte : c'est le traiteur qui décide. */
export function ForceAvailabilityDialog({
  availability,
  onConfirm,
  onCancel,
}: {
  availability: Availability | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations('orders.availability');
  const tc = useTranslations('common');
  const date = availability ? formatLocalDate(availability.date) : '';
  return (
    <AlertDialog open={availability !== null} onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('forceTitle')}</AlertDialogTitle>
          <AlertDialogDescription className="flex flex-col gap-2 text-base">
            {availability?.blocked && (
              <span>
                {t('forceBlocked', { date, reason: availability.blockedReason ?? 'none' })}
              </span>
            )}
            {availability?.full && (
              <span>
                {t('forceFull', {
                  date,
                  firm: availability.firmCount,
                  capacity: availability.capacity ?? 0,
                })}
              </span>
            )}
            <span>{t('forceHint')}</span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel size="lg">{tc('cancel')}</AlertDialogCancel>
          <AlertDialogAction size="lg" onClick={onConfirm}>
            {t('force')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Commande modifiée par quelqu'un d'autre : explication et rechargement. */
export function VersionConflictDialog({
  conflict,
  timeZone,
  onReload,
  onClose,
}: {
  conflict: VersionConflict | null;
  timeZone: string;
  onReload: () => void;
  onClose: () => void;
}) {
  const t = useTranslations('orders.conflict');
  const tc = useTranslations('common');
  const time = conflict?.modifiedAt
    ? formatDateTime(conflict.modifiedAt, timeZone).slice(-5)
    : null;
  return (
    <AlertDialog open={conflict !== null} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('title')}</AlertDialogTitle>
          <AlertDialogDescription className="text-base">
            {conflict?.modifiedBy && time
              ? t('description', { name: conflict.modifiedBy, time })
              : t('descriptionUnknown')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel size="lg">{tc('close')}</AlertDialogCancel>
          <AlertDialogAction size="lg" onClick={onReload}>
            {t('reload')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Saisie d'un motif obligatoire (modification d'une commande confirmée, annulation…). */
export function ReasonDialog({
  open,
  title,
  description,
  warning,
  label,
  placeholder,
  confirmLabel,
  destructive = false,
  pending = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: string;
  warning?: string;
  label: string;
  placeholder?: string;
  confirmLabel: string;
  destructive?: boolean;
  pending?: boolean;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}) {
  const tc = useTranslations('common');
  const tv = useTranslations('validation');
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const missing = reason.trim() === '';
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setReason('');
          setTouched(false);
          onCancel();
        }
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            setTouched(true);
            if (!missing) onConfirm(reason.trim());
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription className="text-base">{description}</DialogDescription>
          </DialogHeader>
          {warning && (
            <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
              {warning}
            </p>
          )}
          <div className="flex flex-col gap-2">
            <label htmlFor="reason" className="font-medium">
              {label}
            </label>
            <Textarea
              id="reason"
              rows={3}
              value={reason}
              placeholder={placeholder}
              aria-invalid={touched && missing}
              onChange={(event) => setReason(event.target.value)}
              autoFocus
            />
            {touched && missing && <FieldError>{tv('required')}</FieldError>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" size="lg" onClick={onCancel}>
              {tc('cancel')}
            </Button>
            <Button
              type="submit"
              size="lg"
              variant={destructive ? 'destructive' : 'default'}
              disabled={pending}
            >
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export interface GuestLineChange {
  index: number;
  label: string;
  from: number;
}

/** Nombre d'invités modifié : proposer d'ajuster les lignes « par personne ». */
export function GuestChangeDialog({
  change,
  onApply,
  onSkip,
}: {
  change: { from: number; to: number; lines: GuestLineChange[] } | null;
  onApply: (indexes: number[]) => void;
  onSkip: () => void;
}) {
  const t = useTranslations('orders.form.guestChange');
  // Cochées par défaut : les lignes dont la quantité suivait l'ancien nombre d'invités
  const [selected, setSelected] = useState<Set<number> | null>(null);
  const checked =
    selected ??
    new Set(
      change?.lines.filter((line) => line.from === change.from).map((line) => line.index) ?? [],
    );

  return (
    <Dialog
      open={change !== null}
      onOpenChange={(open) => {
        if (!open) {
          setSelected(null);
          onSkip();
        }
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription className="text-base">
            {t('description', { from: change?.from ?? 0, to: change?.to ?? 0 })}
          </DialogDescription>
        </DialogHeader>
        <ul className="flex flex-col gap-2">
          {change?.lines.map((line) => (
            <li key={line.index}>
              <label className="flex items-center gap-3 rounded-lg border p-3">
                <Checkbox
                  checked={checked.has(line.index)}
                  onCheckedChange={(value) => {
                    const next = new Set(checked);
                    if (value === true) next.add(line.index);
                    else next.delete(line.index);
                    setSelected(next);
                  }}
                />
                <span>{t('line', { label: line.label, from: line.from, to: change.to })}</span>
              </label>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            size="lg"
            onClick={() => {
              setSelected(null);
              onSkip();
            }}
          >
            {t('skip')}
          </Button>
          <Button
            type="button"
            size="lg"
            onClick={() => {
              onApply([...checked]);
              setSelected(null);
            }}
          >
            {t('apply')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
