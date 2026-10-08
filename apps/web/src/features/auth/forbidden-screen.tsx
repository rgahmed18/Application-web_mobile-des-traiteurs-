import { ShieldXIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { MessageScreen } from '@/components/layout/message-screen';

/** Affiché quand l'utilisateur n'a pas la permission requise par la page. */
export function ForbiddenScreen() {
  const t = useTranslations('pages');
  return (
    <MessageScreen
      icon={ShieldXIcon}
      title={t('forbiddenTitle')}
      description={t('forbiddenDescription')}
      actionLabel={t('goHome')}
      actionHref="/admin"
    />
  );
}
