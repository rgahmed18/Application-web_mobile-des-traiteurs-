'use client';

import type { TwoFactorSetupInfo } from '@traiteur/shared';
import { useTranslations } from 'next-intl';

/**
 * Activation : application à installer, QR code à scanner, ou clé à saisir à la main. Le QR code
 * (SVG produit par l'API) est affiché comme une image, jamais injecté dans la page.
 */
export function TwoFactorSetupView({ info }: { info: TwoFactorSetupInfo }) {
  const t = useTranslations('auth.twoFactor.setup');
  return (
    <div className="flex flex-col gap-4">
      <ol className="flex list-decimal flex-col gap-2 ps-5 text-sm">
        <li>{t('step1')}</li>
        <li>{t('step2')}</li>
        <li>{t('step3')}</li>
      </ol>
      {/* Image en ligne (data:), rien à optimiser pour next/image */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(info.qrSvg)}`}
        alt={t('qrAlt')}
        className="mx-auto size-52 rounded-lg border bg-white p-2"
        data-testid="two-factor-qr"
      />
      <div className="flex flex-col gap-1 text-center">
        <span className="text-sm text-muted-foreground">{t('manualKey')}</span>
        <code
          className="rounded bg-muted px-2 py-1 font-mono text-sm tracking-wider break-all"
          dir="ltr"
          data-testid="two-factor-secret"
        >
          {info.secret}
        </code>
      </div>
    </div>
  );
}
