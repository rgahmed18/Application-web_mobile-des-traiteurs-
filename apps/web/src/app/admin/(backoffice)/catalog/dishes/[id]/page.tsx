import { Suspense } from 'react';

import { DishEditor } from '@/features/catalog/dishes/dish-editor';

export default async function EditDishPage({ params }: PageProps<'/admin/catalog/dishes/[id]'>) {
  const { id } = await params;
  return (
    <Suspense>
      <DishEditor dishId={id} />
    </Suspense>
  );
}
