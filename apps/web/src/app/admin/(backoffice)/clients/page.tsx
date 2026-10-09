import { RequirePermission } from '@/features/auth/auth-gates';
import { ClientList } from '@/features/clients/client-list';

export default function ClientsPage() {
  return (
    <RequirePermission permission="clients.read">
      <ClientList />
    </RequirePermission>
  );
}
