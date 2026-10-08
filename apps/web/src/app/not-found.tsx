import { SearchXIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { MessageScreen } from '@/components/layout/message-screen';

export default function NotFound() {
  const t = useTranslations('pages');
  return (
    <MessageScreen
      icon={SearchXIcon}
      title={t('notFoundTitle')}
      description={t('notFoundDescription')}
      actionLabel={t('goHome')}
      actionHref="/admin"
    />
  );
}
