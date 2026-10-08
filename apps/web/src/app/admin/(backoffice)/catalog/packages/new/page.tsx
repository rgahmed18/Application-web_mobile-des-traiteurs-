import { Suspense } from 'react';

import { PackageEditor } from '@/features/catalog/packages/package-editor';

export default function NewPackagePage() {
  // useSearchParams (duplication : ?from=<id>) exige une frontière Suspense
  return (
    <Suspense>
      <PackageEditor packageId={null} />
    </Suspense>
  );
}
