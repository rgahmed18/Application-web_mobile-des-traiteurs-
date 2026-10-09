import { Suspense } from 'react';

import { OrderEditor } from '@/features/orders/form/order-editor';

export default function NewOrderPage() {
  // useSearchParams (?date=, ?client=) exige une frontière Suspense
  return (
    <Suspense>
      <OrderEditor orderId={null} />
    </Suspense>
  );
}
