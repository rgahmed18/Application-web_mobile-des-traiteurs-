import { EquipmentEditor } from '@/features/catalog/equipment/equipment-editor';

export default async function EditEquipmentPage({
  params,
}: PageProps<'/admin/catalog/equipment/[id]'>) {
  const { id } = await params;
  return <EquipmentEditor equipmentId={id} />;
}
