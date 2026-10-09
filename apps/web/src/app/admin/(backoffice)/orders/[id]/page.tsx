import { RequirePermission } from '@/features/auth/auth-gates';
import { OrderDetail } from '@/features/orders/order-detail';

export default async function OrderPage({ params }: PageProps<'/admin/orders/[id]'>) {
  const { id } = await params;
  return (
    <RequirePermission permission="orders.read">
      <OrderDetail orderId={id} />
    </RequirePermission>
  );
}
