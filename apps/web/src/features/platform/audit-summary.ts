'use client';

import {
  FEATURE_KEYS,
  type FeatureKey,
  type PlatformAuditEntry,
  SUBSCRIPTION_PLANS,
  type SubscriptionPlan,
  TRAITEUR_STATUSES,
  type TraiteurStatus,
} from '@traiteur/shared';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback } from 'react';

import { formatDate, formatDateTime } from '@/lib/format/date';
import { currencyLabel, formatAmount, formatMoney } from '@/lib/format/money';

type Change = Record<string, unknown> | null;

const ROLES = ['SUPER_ADMIN', 'ADMIN_TRAITEUR', 'EMPLOYE', 'EQUIPE', 'LIVREUR', 'CLIENT'] as const;
type AuditRole = (typeof ROLES)[number];

const isOneOf = <T extends string>(values: readonly T[], value: unknown): value is T =>
  typeof value === 'string' && (values as readonly string[]).includes(value);
const str = (change: Change, key: string): string | null => {
  const value = change?.[key];
  return typeof value === 'string' ? value : null;
};
const num = (change: Change, key: string): number | null => {
  const value = change?.[key];
  return typeof value === 'number' ? value : null;
};
const bool = (change: Change, key: string): boolean | null => {
  const value = change?.[key];
  return typeof value === 'boolean' ? value : null;
};
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/** « 400 » pour un montant rond, sinon « 400,50 » (devise ajoutée une fois, après la flèche). */
function compactAmount(cents: number): string {
  return formatAmount(cents).replace(/,00$/, '');
}

/**
 * Lecture d'une ligne du journal sans ouvrir la base : résumé en une phrase (« Employé ·
 * Consulter les devis : activée → désactivée », « Dar Diafa : PRO → PREMIUM », « Basique :
 * 400 → 450 MAD ») et libellés des valeurs de la vue détail.
 */
export function useAuditDescriber() {
  const t = useTranslations('platform.audit');
  const tStatus = useTranslations('platform.status');
  const tFeature = useTranslations('platform.features');
  const tPermission = useTranslations('staff.permissions');
  const locale = useLocale();

  const role = useCallback(
    (value: unknown) => (isOneOf<AuditRole>(ROLES, value) ? t(`roles.${value}`) : String(value)),
    [t],
  );
  const plan = useCallback(
    (value: unknown) =>
      isOneOf<SubscriptionPlan>(SUBSCRIPTION_PLANS, value) ? t(`plans.${value}`) : String(value),
    [t],
  );
  const status = useCallback(
    (value: unknown) =>
      isOneOf<TraiteurStatus>(TRAITEUR_STATUSES, value) ? tStatus(value) : String(value),
    [tStatus],
  );
  const permission = useCallback(
    (value: unknown) => {
      const key = `keys.${String(value).replace('.', '_')}` as 'keys.catalog_read';
      return tPermission.has(key) ? tPermission(key) : String(value);
    },
    [tPermission],
  );
  const feature = useCallback(
    (value: unknown) =>
      isOneOf<FeatureKey>(FEATURE_KEYS, value) ? tFeature(value) : String(value),
    [tFeature],
  );
  const state = useCallback(
    (value: boolean | null) => (value === null ? '—' : t(value ? 'state.on' : 'state.off')),
    [t],
  );

  /** Valeur lisible d'un champ de la vue détail. */
  const value = useCallback(
    (key: string, raw: unknown): string => {
      if (raw === null || raw === undefined || raw === '') return '—';
      if (key === 'granted' || key === 'enabled') return state(raw === true);
      if (key === 'role') return role(raw);
      if (key === 'plan') return plan(raw);
      if (key === 'status') return status(raw);
      if (key === 'monthlyPrice' && typeof raw === 'number') {
        return formatMoney(raw, locale);
      }
      if (typeof raw === 'boolean') return t(raw ? 'state.yes' : 'state.no');
      if (typeof raw === 'string' && ISO_DATE_TIME.test(raw)) return formatDateTime(raw);
      return typeof raw === 'string' || typeof raw === 'number' ? String(raw) : JSON.stringify(raw);
    },
    [locale, plan, role, state, status, t],
  );

  /** Libellé d'un champ de la vue détail (clé technique si inconnue). */
  const field = useCallback(
    (key: string) => {
      const id = `fields.${key}` as 'fields.plan';
      return t.has(id) ? t(id) : key;
    },
    [t],
  );

  /** Résumé d'une ligne ; null si l'action n'a pas de détail lisible. */
  const summary = useCallback(
    (entry: PlatformAuditEntry): string | null => {
      const { before, after } = entry;
      const traiteur = entry.traiteur?.name ?? t('noTraiteur');
      switch (entry.action) {
        case 'platform.permission_default_changed':
          return t('summary.permission', {
            role: role(after?.role),
            permission: permission(after?.key),
            before: state(bool(before, 'granted')),
            after: state(bool(after, 'granted')),
          });
        case 'platform.plan_changed':
          return t('summary.change', {
            subject: traiteur,
            before: plan(before?.plan),
            after: plan(after?.plan),
          });
        case 'platform.plan_price_changed': {
          const from = num(before, 'monthlyPrice');
          const to = num(after, 'monthlyPrice');
          if (from === null || to === null) return null;
          return t('summary.price', {
            plan: plan(after?.plan),
            before: compactAmount(from),
            after: compactAmount(to),
            currency: currencyLabel(locale),
          });
        }
        case 'platform.feature_toggled':
          return t('summary.feature', {
            traiteur,
            feature: feature(after?.key),
            before: state(bool(before, 'enabled')),
            after: state(bool(after, 'enabled')),
          });
        case 'platform.traiteur_suspended':
          return t('summary.suspended', {
            traiteur,
            before: status(before?.status),
            after: status(after?.status),
            reason: str(after, 'reason') ?? '—',
          });
        case 'platform.traiteur_reactivated':
        case 'platform.subscription_activated':
          return t('summary.change', {
            subject: traiteur,
            before: status(before?.status),
            after: status(after?.status),
          });
        case 'platform.trial_updated': {
          const from = str(before, 'trialEndsAt');
          const to = str(after, 'trialEndsAt');
          return t('summary.trial', {
            traiteur,
            before: from ? formatDate(from) : '—',
            after: to ? formatDate(to) : '—',
          });
        }
        case 'platform.traiteur_created':
          return t('summary.created', {
            traiteur,
            plan: plan(after?.plan),
            days: num(after, 'trialDays') ?? 0,
          });
        case 'platform.access_started':
        case 'platform.access_extended': {
          const until = str(after, 'expiresAt');
          return t('summary.access', {
            traiteur,
            reason: str(after, 'reason') ?? '—',
            until: until ? formatDateTime(until) : '—',
          });
        }
        case 'platform.domain_added':
        case 'platform.domain_verified':
        case 'platform.domain_disabled':
        case 'platform.domain_removed':
          return t('summary.domain', {
            traiteur,
            hostname: str(after, 'hostname') ?? str(before, 'hostname') ?? '—',
          });
        case 'platform.access_ended':
          return t('summary.accessEnded', {
            traiteur,
            how: t(str(after, 'endReason') === 'EXPIRED' ? 'endReason.EXPIRED' : 'endReason.LEFT'),
          });
        default:
          return entry.detail;
      }
    },
    [feature, locale, permission, plan, role, state, status, t],
  );

  return { summary, field, value, role };
}
