import { RequirePermission } from '@/features/auth/auth-gates';
import { SettingsView } from '@/features/settings/billing-settings-form';

export default function SettingsPage() {
  return (
    <RequirePermission permission="settings.manage">
      <SettingsView />
    </RequirePermission>
  );
}
