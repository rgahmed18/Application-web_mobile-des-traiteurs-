import { TraiteurDetailView } from '@/features/platform/traiteur-detail-view';

export default async function PlatformTraiteurPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <TraiteurDetailView id={id} />;
}
