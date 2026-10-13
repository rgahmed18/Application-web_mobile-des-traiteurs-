import { RequirePermission } from '@/features/auth/auth-gates';
import { StaffView } from '@/features/staff/staff-view';

export default function StaffPage() {
  return (
    <RequirePermission permission="staff.read">
      <StaffView />
    </RequirePermission>
  );
}
