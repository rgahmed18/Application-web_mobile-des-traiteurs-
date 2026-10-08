import { Suspense } from 'react';

import { PackageEditor } from '@/features/catalog/packages/package-editor';

export default async function EditPackagePage({
  params,
}: PageProps<'/admin/catalog/packages/[id]'>) {
  const { id } = await params;
  return (
    <Suspense>
      <PackageEditor packageId={id} />
    </Suspense>
  );
}
