import { RequirePermission } from '@/features/auth/auth-gates';
import { ClientDetail } from '@/features/clients/client-detail';

export default async function ClientPage({ params }: PageProps<'/admin/clients/[id]'>) {
  const { id } = await params;
  return (
    <RequirePermission permission="clients.read">
      <ClientDetail clientId={id} />
    </RequirePermission>
  );
}
