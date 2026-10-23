import { RequireSession } from '@/features/auth/auth-gates';
import { BackofficeShell } from '@/features/navigation/backoffice-shell';

/** Back-office d'un traiteur : exige une session. */
export default function BackofficeLayout({ children }: LayoutProps<'/admin'>) {
  return (
    <RequireSession>
      <BackofficeShell>{children}</BackofficeShell>
    </RequireSession>
  );
}
