import { SessionProvider } from '@/features/auth/session-provider';

/**
 * Back-office d'un traiteur (et ses écrans de connexion) : session du personnel. Le site client
 * (racine de l'adresse) a sa propre session, jamais chargée ici.
 */
export default function AdminLayout({ children }: LayoutProps<'/admin'>) {
  return <SessionProvider>{children}</SessionProvider>;
}
