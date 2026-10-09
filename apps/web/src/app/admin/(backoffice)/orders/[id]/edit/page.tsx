import { Suspense } from 'react';

import { OrderEditor } from '@/features/orders/form/order-editor';

export default async function EditOrderPage({ params }: PageProps<'/admin/orders/[id]/edit'>) {
  const { id } = await params;
  return (
    <Suspense>
      <OrderEditor orderId={id} />
    </Suspense>
  );
}
