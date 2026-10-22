import { AccountTab } from '@/features/settings/account-forms';

/** « Mon compte » du super admin : profil, mot de passe, double authentification. */
export default function PlatformAccountPage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <AccountTab />
    </div>
  );
}
