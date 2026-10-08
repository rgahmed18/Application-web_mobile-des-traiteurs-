'use client';

import { useSearchParams } from 'next/navigation';

import { Skeleton } from '@/components/ui/skeleton';
import { RequirePermission } from '@/features/auth/auth-gates';

import { useCatalogSettings, useDish } from '../catalog-api';
import { DishForm } from './dish-form';

function FormSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <Skeleton className="h-10 w-64" />
      <Skeleton className="h-64 w-full" />
      <Skeleton className="h-48 w-full" />
    </div>
  );
}

/** Création (éventuellement à partir d'un plat dupliqué : ?from=<id>) ou modification. */
export function DishEditor({ dishId }: { dishId: string | null }) {
  const duplicateFrom = useSearchParams().get('from');
  const sourceId = dishId ?? duplicateFrom;
  const settings = useCatalogSettings();
  const source = useDish(sourceId);

  const ready = settings.data && (!sourceId || source.data);
  return (
    <RequirePermission permission="catalog.write">
      {!ready ? (
        <FormSkeleton />
      ) : (
        <DishForm
          // Nouveau rendu si l'on passe d'un plat à un autre
          key={sourceId ?? 'new'}
          settings={settings.data}
          dish={source.data}
          mode={dishId ? 'edit' : duplicateFrom ? 'duplicate' : 'create'}
        />
      )}
    </RequirePermission>
  );
}
