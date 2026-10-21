'use client';

import { Skeleton } from '@/components/ui/skeleton';
import { RequirePermission } from '@/features/auth/auth-gates';

import { useBuffet, useCatalogSettings } from '../catalog-api';
import { BuffetForm } from './buffet-form';

/** Création ou modification d'un buffet. */
export function BuffetEditor({ buffetId }: { buffetId: string | null }) {
  const settings = useCatalogSettings();
  const buffet = useBuffet(buffetId);
  const ready = settings.data && (!buffetId || buffet.data);
  return (
    <RequirePermission permission="catalog.write">
      {!ready ? (
        <div className="flex flex-col gap-6" aria-busy="true">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : (
        <BuffetForm key={buffetId ?? 'new'} settings={settings.data} buffet={buffet.data} />
      )}
    </RequirePermission>
  );
}
