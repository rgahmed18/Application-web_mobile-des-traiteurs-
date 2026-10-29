import type { DraftForm, DraftFormKey } from '@traiteur/shared';

/** Formulaire et cible d'une clé de brouillon (« dish:<id> » → plat, identifiant). */
export function parseDraftKey(formKey: DraftFormKey): { form: DraftForm; target: string } {
  const [form = '', target = ''] = formKey.split(':');
  return { form: form as DraftForm, target };
}

const SETTINGS_TABS: Record<string, string> = {
  company: 'company',
  billing: 'billing',
  availability: 'availability',
  pricing: 'pricing',
};

/**
 * Page où reprendre un brouillon. Les formulaires en fenêtre (client, service, devis) s'ouvrent
 * d'eux-mêmes avec « ?draft=<clé> ».
 */
export function draftHref(formKey: DraftFormKey): string {
  const { form, target } = parseDraftKey(formKey);
  const isNew = target === 'new';
  const draft = `draft=${encodeURIComponent(formKey)}`;
  switch (form) {
    case 'order':
      return isNew ? '/admin/orders/new' : `/admin/orders/${target}/edit`;
    case 'quote':
      return `/admin/orders/${target}?${draft}`;
    case 'client':
      return isNew ? `/admin/clients?${draft}` : `/admin/clients/${target}?${draft}`;
    case 'dish':
      return isNew ? '/admin/catalog/dishes/new' : `/admin/catalog/dishes/${target}`;
    case 'package':
      return isNew ? '/admin/catalog/packages/new' : `/admin/catalog/packages/${target}`;
    case 'buffet':
      return isNew ? '/admin/catalog/buffets/new' : `/admin/catalog/buffets/${target}`;
    case 'equipment':
      return isNew ? '/admin/catalog/equipment/new' : `/admin/catalog/equipment/${target}`;
    case 'service':
      return `/admin/catalog/services?${draft}`;
    case 'settings':
      return `/admin/settings?tab=${SETTINGS_TABS[target] ?? 'company'}`;
  }
}
