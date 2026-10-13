import { MissionsList } from '@/features/assignments/missions-view';
import { RequirePermission } from '@/features/auth/auth-gates';

export default function MissionsPage() {
  return (
    <RequirePermission permission="assignments.read_own">
      <MissionsList />
    </RequirePermission>
  );
}
