import { RequirePermission } from '@/features/auth/auth-gates';
import { CashDeskView } from '@/features/payments/cash-desk-view';

export default function CashDeskPage() {
  return (
    <RequirePermission permission="payments.record">
      <CashDeskView />
    </RequirePermission>
  );
}
