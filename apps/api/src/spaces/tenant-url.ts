/**
 * Adresse d'un traiteur à partir du modèle TENANT_URL_TEMPLATE (« https://{slug}.exemple.ma »),
 * sans barre finale. Utilisé aussi par les commandes serveur (hors Nest).
 */
export function tenantUrlFromTemplate(template: string, slug: string): string {
  return template.replace('{slug}', slug).replace(/\/+$/, '');
}
