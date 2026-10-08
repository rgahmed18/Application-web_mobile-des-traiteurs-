import { Suspense } from 'react';

import { DishEditor } from '@/features/catalog/dishes/dish-editor';

export default function NewDishPage() {
  // useSearchParams (duplication : ?from=<id>) exige une frontière Suspense
  return (
    <Suspense>
      <DishEditor dishId={null} />
    </Suspense>
  );
}
