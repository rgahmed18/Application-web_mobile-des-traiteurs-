import { notFound } from 'next/navigation';

import { CART_KINDS } from '@/features/site/cart-kinds';
import { CatalogItemView } from '@/features/site/catalog-item-view';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Fiche d'un menu, buffet, matériel ou service publié. */
export default async function CatalogItemPage({
  params,
}: {
  params: Promise<{ kind: string; id: string }>;
}) {
  const { kind, id } = await params;
  const known = CART_KINDS.find((candidate) => candidate === kind);
  if (!known || !UUID.test(id)) notFound();
  return <CatalogItemView kind={known} id={id} />;
}
