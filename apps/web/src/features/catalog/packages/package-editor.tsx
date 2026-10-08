'use client';

import { useSearchParams } from 'next/navigation';

import { Skeleton } from '@/components/ui/skeleton';
import { RequirePermission } from '@/features/auth/auth-gates';

import { useCatalogSettings, usePackage } from '../catalog-api';
import { PackageForm } from './package-form';

function FormSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <Skeleton className="h-10 w-64" />
      <Skeleton className="h-64 w-full" />
      <Skeleton className="h-48 w-full" />
    </div>
  );
}

/** Création (éventuellement à partir d'une formule dupliquée : ?from=<id>) ou modification. */
export function PackageEditor({ packageId }: { packageId: string | null }) {
  const duplicateFrom = useSearchParams().get('from');
  const sourceId = packageId ?? duplicateFrom;
  const settings = useCatalogSettings();
  const source = usePackage(sourceId);

  const ready = settings.data && (!sourceId || source.data);
  return (
    <RequirePermission permission="catalog.write">
      {!ready ? (
        <FormSkeleton />
      ) : (
        <PackageForm
          // Nouveau rendu si l'on passe d'une formule à une autre
          key={sourceId ?? 'new'}
          settings={settings.data}
          pkg={source.data}
          mode={packageId ? 'edit' : duplicateFrom ? 'duplicate' : 'create'}
        />
      )}
    </RequirePermission>
  );
}
