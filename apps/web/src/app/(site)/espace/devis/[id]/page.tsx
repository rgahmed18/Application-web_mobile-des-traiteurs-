import { notFound } from 'next/navigation';

import { SpaceQuote } from '@/features/site/space/space-documents';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export default async function DevisDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  return <SpaceQuote id={id} />;
}
