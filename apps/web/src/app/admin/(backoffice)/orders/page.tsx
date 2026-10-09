import { Suspense } from 'react';

import { RequirePermission } from '@/features/auth/auth-gates';
import { OrderList } from '@/features/orders/order-list';

export default function OrdersPage() {
  // useSearchParams (filtres reçus du tableau de bord) exige une frontière Suspense
  return (
    <RequirePermission permission="orders.read">
      <Suspense>
        <OrderList />
      </Suspense>
    </RequirePermission>
  );
}
