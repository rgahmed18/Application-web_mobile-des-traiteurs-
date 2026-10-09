import { RequirePermission } from '@/features/auth/auth-gates';
import { InvoiceList } from '@/features/invoices/invoice-list';

export default function InvoicesPage() {
  return (
    <RequirePermission permission="invoices.read">
      <InvoiceList />
    </RequirePermission>
  );
}
