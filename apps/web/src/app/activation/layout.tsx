import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { currentSpace } from '@/lib/space/space.server';

/** Activation d'un compte de la plateforme : seulement sur l'adresse de la console. */
export default async function ActivationLayout({ children }: { children: ReactNode }) {
  if ((await currentSpace())?.kind !== 'platform') notFound();
  return children;
}
