'use client';

import { getLocalizedText, type PrivacyController } from '@traiteur/shared';
import { useLocale, useTranslations } from 'next-intl';

import { LoadError } from '@/components/layout/load-error';
import { Skeleton } from '@/components/ui/skeleton';

import { usePublicPrivacy } from './site-api';

/** Sections du modèle (texte dans les messages site.privacy.sections). */
const SECTIONS = [
  'data',
  'purposes',
  'legalBasis',
  'recipients',
  'retention',
  'security',
  'rights',
] as const;

/** Identité du responsable du traitement, à partir des informations légales du traiteur. */
function controllerLines(controller: PrivacyController): string[] {
  return [
    [controller.legalName ?? controller.name, controller.legalForm].filter(Boolean).join(', '),
    controller.ice ? `ICE ${controller.ice}` : null,
    controller.rcNumber
      ? `RC ${controller.rcNumber}${controller.rcCourt ? ` (${controller.rcCourt})` : ''}`
      : null,
    [controller.address, controller.city].filter(Boolean).join(', ') || null,
    `${controller.email} · ${controller.phone}`,
  ].filter((line): line is string => Boolean(line));
}

/**
 * Politique de confidentialité du traiteur (loi 09-08) : modèle traduit, informations légales du
 * traiteur, n° de déclaration CNDP et paragraphe libre. La version affichée est celle que le
 * client accepte à son inscription.
 */
export function PrivacyPolicy() {
  const t = useTranslations('site.privacy');
  const locale = useLocale();
  const query = usePublicPrivacy();
  if (query.isPending) return <Skeleton className="h-96 w-full" />;
  if (!query.data) return <LoadError error={query.error} backHref="/" />;
  const policy = query.data;
  const name = policy.controller.legalName ?? policy.controller.name;

  return (
    <article className="mx-auto flex max-w-3xl flex-col gap-6" data-testid="privacy-policy">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-muted-foreground">{t('intro', { name })}</p>
      </header>
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">{t('controllerTitle')}</h2>
        <address className="flex flex-col not-italic" dir="auto">
          {controllerLines(policy.controller).map((line) => (
            <span key={line}>{line}</span>
          ))}
        </address>
        <p>
          {policy.cndpDeclaration
            ? t('cndp', { number: policy.cndpDeclaration })
            : t('cndpPending')}
        </p>
      </section>
      {SECTIONS.map((section) => (
        <section key={section} className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">{t(`sections.${section}.title`)}</h2>
          <p className="leading-relaxed whitespace-pre-line">
            {t(`sections.${section}.body`, { name, email: policy.controller.email })}
          </p>
        </section>
      ))}
      {policy.extra && (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">{t('extraTitle', { name })}</h2>
          <p className="leading-relaxed whitespace-pre-line" dir="auto">
            {getLocalizedText(policy.extra, locale === 'ar' ? 'ar' : 'fr')}
          </p>
        </section>
      )}
      <p className="text-sm text-muted-foreground">{t('version', { version: policy.version })}</p>
    </article>
  );
}
