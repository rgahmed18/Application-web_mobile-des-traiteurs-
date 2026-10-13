import { MissionDetail } from '@/features/assignments/missions-view';
import { RequirePermission } from '@/features/auth/auth-gates';

export default async function MissionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <RequirePermission permission="assignments.read_own">
      <MissionDetail id={id} />
    </RequirePermission>
  );
}
