import { RequirePermission } from '@/features/auth/auth-gates';

/** Catalogue : consultation réservée à la permission catalog.read. */
export default function CatalogLayout({ children }: LayoutProps<'/admin/catalog'>) {
  return <RequirePermission permission="catalog.read">{children}</RequirePermission>;
}
