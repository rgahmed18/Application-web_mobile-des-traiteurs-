/**
 * Brouillon à rouvrir, demandé par le lien « Reprendre » du tableau de bord (« ?draft=<clé> ») :
 * les formulaires en fenêtre (client, service, devis) s'ouvrent alors d'eux-mêmes. Lu à
 * l'initialisation (le back-office n'est rendu qu'une fois la session restaurée, côté
 * navigateur).
 */
export function draftParam(): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('draft');
}
