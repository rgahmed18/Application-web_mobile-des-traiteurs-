import { describe, expect, it } from 'vitest';

import { permissionInconsistencies, PERMISSIONS, resolveEffectivePermissions } from './permissions';

describe('catalogue PERMISSIONS', () => {
  it('a des clés uniques', () => {
    const keys = PERMISSIONS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('marque la facturation et l’abonnement comme critiques', () => {
    const critical = PERMISSIONS.filter((p) => !p.isTenantEditable).map((p) => p.key);
    expect(critical).toEqual(
      expect.arrayContaining(['invoices.issue', 'invoices.credit_note', 'subscription.manage']),
    );
  });

  it('réserve l’écriture du catalogue à l’administrateur, sans dérogation possible', () => {
    const write = PERMISSIONS.find((p) => p.key === 'catalog.write');
    expect(write).toMatchObject({ isTenantEditable: false, defaultRoles: ['ADMIN_TRAITEUR'] });
  });
});

describe('resolveEffectivePermissions', () => {
  const defaults = [
    { permissionKey: 'orders.read', granted: true },
    { permissionKey: 'quotes.manage', granted: true },
    { permissionKey: 'invoices.issue', granted: true },
  ];
  const critical = new Set(['invoices.issue', 'subscription.manage']);

  it('retourne la matrice par défaut sans surcharge', () => {
    expect([...resolveEffectivePermissions(defaults, [], critical)].sort()).toEqual([
      'invoices.issue',
      'orders.read',
      'quotes.manage',
    ]);
  });

  it('applique les retraits et ajouts du traiteur', () => {
    const result = resolveEffectivePermissions(
      defaults,
      [
        { permissionKey: 'quotes.manage', granted: false },
        { permissionKey: 'catalog.write', granted: true },
      ],
      critical,
    );
    expect(result.has('quotes.manage')).toBe(false);
    expect(result.has('catalog.write')).toBe(true);
  });

  it('ignore toute surcharge d’une permission critique', () => {
    const result = resolveEffectivePermissions(
      defaults,
      [
        { permissionKey: 'invoices.issue', granted: false },
        { permissionKey: 'subscription.manage', granted: true },
      ],
      critical,
    );
    expect(result.has('invoices.issue')).toBe(true);
    expect(result.has('subscription.manage')).toBe(false);
  });

  it('ignore une ligne par défaut non accordée', () => {
    const result = resolveEffectivePermissions(
      [{ permissionKey: 'orders.read', granted: false }],
      [],
      critical,
    );
    expect(result.size).toBe(0);
  });
});

describe('cohérence de la matrice par défaut', () => {
  it('aucun rôle n’a un droit d’agir sans le droit de consulter qu’il suppose', () => {
    const roles = [...new Set(PERMISSIONS.flatMap((p) => p.defaultRoles))];
    const problems = roles.flatMap((role) =>
      permissionInconsistencies((key) =>
        PERMISSIONS.some(
          (p) => p.key === key && (p.defaultRoles as readonly string[]).includes(role),
        ),
      ).map(({ key, needed }) => `${role} : ${key} sans ${needed}`),
    );
    expect(problems).toEqual([]);
  });

  it('l’employé consulte les paiements qu’il enregistre', () => {
    const roles = (key: string) =>
      PERMISSIONS.find((p) => p.key === key)?.defaultRoles as readonly string[] | undefined;
    expect(roles('payments.record')).toContain('EMPLOYE');
    expect(roles('payments.read')).toContain('EMPLOYE');
  });
});
