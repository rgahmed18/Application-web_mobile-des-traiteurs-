import type { PermissionKey } from '@traiteur/shared';
import { HourglassIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { RequirePermission } from '@/features/auth/auth-gates';

import { MessageScreen } from './message-screen';

/** Section prévue mais pas encore développée (respecte quand même les permissions). */
export function ComingSoon({ permission }: { permission: PermissionKey }) {
  const t = useTranslations('comingSoon');
  return (
    <RequirePermission permission={permission}>
      <MessageScreen
        icon={HourglassIcon}
        title={t('title')}
        description={t('description')}
        actionLabel={t('backToDashboard')}
        actionHref="/admin"
      />
    </RequirePermission>
  );
}
