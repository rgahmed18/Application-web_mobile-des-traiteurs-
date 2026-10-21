import { BuffetEditor } from '@/features/catalog/buffets/buffet-editor';

export default async function EditBuffetPage({ params }: PageProps<'/admin/catalog/buffets/[id]'>) {
  const { id } = await params;
  return <BuffetEditor buffetId={id} />;
}
