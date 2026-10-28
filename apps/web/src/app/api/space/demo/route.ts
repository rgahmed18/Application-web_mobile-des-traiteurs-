import { type NextRequest, NextResponse } from 'next/server';

import { serverEnv } from '@/lib/env/server';
import { DEMO_SPACE_COOKIE } from '@/lib/space/space.server';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Démonstration uniquement (DEMO_SPACE_SELECTION, refusée en production) : mémorise le traiteur
 * choisi sur l'adresse de la console (« ?traiteur=dar-diafa »), ou revient à la console
 * (« ?traiteur=platform »), puis renvoie vers la page de connexion. La session ouverte sur
 * l'adresse ne vaut que pour cet espace : changer d'espace impose de se reconnecter.
 */
export function GET(request: NextRequest) {
  if (!serverEnv().DEMO_SPACE_SELECTION) {
    return NextResponse.json({ code: 'NOT_FOUND', message: 'Introuvable' }, { status: 404 });
  }
  const choice = request.nextUrl.searchParams.get('traiteur') ?? '';
  const response = NextResponse.redirect(new URL('/admin/login', request.url));
  if (choice === 'platform' || !SLUG.test(choice)) {
    response.cookies.delete(DEMO_SPACE_COOKIE);
  } else {
    response.cookies.set(DEMO_SPACE_COOKIE, choice, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 30 * 24 * 60 * 60,
    });
  }
  return response;
}
