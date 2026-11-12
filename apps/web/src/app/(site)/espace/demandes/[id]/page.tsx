import { notFound } from 'next/navigation';

import { SpaceOrderDetail } from '@/features/site/space/space-orders';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export default async function DemandePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  return <SpaceOrderDetail id={id} />;
}
