import { ChefHatIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';

/** Logo et nom de l'application. */
export function Brand() {
  const t = useTranslations('common');
  return (
    <div className="flex items-center gap-3">
      <span className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <ChefHatIcon className="size-6" aria-hidden />
      </span>
      <span className="text-lg font-semibold">{t('appName')}</span>
    </div>
  );
}
