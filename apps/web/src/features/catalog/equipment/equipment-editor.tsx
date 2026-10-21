'use client';

import { Skeleton } from '@/components/ui/skeleton';
import { RequirePermission } from '@/features/auth/auth-gates';

import { useCatalogSettings, useEquipment } from '../catalog-api';
import { EquipmentForm } from './equipment-form';

/** Création ou modification d'un article de matériel. */
export function EquipmentEditor({ equipmentId }: { equipmentId: string | null }) {
  const settings = useCatalogSettings();
  const item = useEquipment(equipmentId);
  const ready = settings.data && (!equipmentId || item.data);
  return (
    <RequirePermission permission="catalog.write">
      {!ready ? (
        <div className="flex flex-col gap-6" aria-busy="true">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : (
        <EquipmentForm key={equipmentId ?? 'new'} settings={settings.data} item={item.data} />
      )}
    </RequirePermission>
  );
}
