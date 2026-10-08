import { redirect } from 'next/navigation';

/** La racine est réservée au futur site client ; pour l'instant, direction le back-office. */
export default function HomePage() {
  redirect('/admin');
}
