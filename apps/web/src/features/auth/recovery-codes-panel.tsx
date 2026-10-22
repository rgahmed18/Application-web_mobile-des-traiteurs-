'use client';

import { CopyIcon, DownloadIcon, ShieldAlertIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';

/**
 * Codes de secours affichés UNE seule fois : copie, téléchargement, et confirmation explicite
 * qu'ils sont rangés (gestionnaire de mots de passe et copie papier) avant de continuer.
 */
export function RecoveryCodesPanel({
  codes,
  continueLabel,
  onContinue,
}: {
  codes: string[];
  continueLabel: string;
  onContinue: () => void | Promise<void>;
}) {
  const t = useTranslations('auth.twoFactor.recovery');
  const [stored, setStored] = useState(false);
  const [busy, setBusy] = useState(false);
  const text = `${t('fileTitle')}\n\n${codes.join('\n')}\n`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t('copied'));
    } catch {
      toast.error(t('copyFailed'));
    }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'codes-de-secours-gestion-traiteurs.txt';
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col gap-4" data-testid="recovery-codes">
      <div className="flex gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
        <ShieldAlertIcon className="mt-0.5 size-5 shrink-0" aria-hidden />
        <div className="flex flex-col gap-1 text-sm">
          <p className="font-semibold">{t('warningTitle')}</p>
          <p>{t('warning')}</p>
        </div>
      </div>
      <ol
        className="grid grid-cols-2 gap-2 rounded-lg border bg-muted/40 p-4 font-mono text-base"
        dir="ltr"
      >
        {codes.map((code) => (
          <li key={code} className="text-center tracking-wider">
            {code}
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={() => void copy()}>
          <CopyIcon aria-hidden />
          {t('copy')}
        </Button>
        <Button type="button" variant="outline" onClick={download}>
          <DownloadIcon aria-hidden />
          {t('download')}
        </Button>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <Checkbox
          checked={stored}
          onCheckedChange={(checked) => setStored(checked === true)}
          className="mt-0.5"
        />
        {t('confirmStored')}
      </label>
      <Button
        type="button"
        size="lg"
        disabled={!stored || busy}
        onClick={() => {
          setBusy(true);
          void Promise.resolve(onContinue()).finally(() => setBusy(false));
        }}
      >
        {continueLabel}
      </Button>
    </div>
  );
}
