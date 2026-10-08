import { getErrorCode } from '../../common/errors';
import { FEATURE_KEY, IS_PUBLIC_KEY, PERMISSIONS_KEY, ROLES_KEY } from '../../auth/decorators';
import type { PrismaService } from '../../prisma/prisma.service';
import { buildUser, createHttpContext, createReflector } from '../../testing/execution-context';
import type { FeaturesService } from '../features.service';
import type { PermissionsService } from '../permissions.service';
import { FeatureGuard } from './feature.guard';
import { PermissionsGuard } from './permissions.guard';
import { RolesGuard } from './roles.guard';
import { TenantGuard } from './tenant.guard';

async function expectErrorCode(promise: Promise<unknown> | (() => unknown), code: string) {
  try {
    await (typeof promise === 'function' ? promise() : promise);
  } catch (error) {
    expect(getErrorCode(error)).toBe(code);
    return;
  }
  throw new Error(`Une erreur ${code} était attendue`);
}

describe('RolesGuard', () => {
  it('laisse passer une route sans @Roles', () => {
    const guard = new RolesGuard(createReflector({}));
    expect(guard.canActivate(createHttpContext({ user: buildUser() }))).toBe(true);
  });

  it('autorise un rôle listé et refuse les autres', async () => {
    const guard = new RolesGuard(createReflector({ [ROLES_KEY]: ['ADMIN_TRAITEUR'] }));
    expect(
      guard.canActivate(createHttpContext({ user: buildUser({ role: 'ADMIN_TRAITEUR' }) })),
    ).toBe(true);
    await expectErrorCode(
      () => guard.canActivate(createHttpContext({ user: buildUser({ role: 'CLIENT' }) })),
      'FORBIDDEN_ROLE',
    );
  });

  it('laisse toujours passer le SUPER_ADMIN', () => {
    const guard = new RolesGuard(createReflector({ [ROLES_KEY]: ['ADMIN_TRAITEUR'] }));
    const user = buildUser({ role: 'SUPER_ADMIN', isSuperAdmin: true });
    expect(guard.canActivate(createHttpContext({ user }))).toBe(true);
  });

  it('ignore les routes publiques', () => {
    const guard = new RolesGuard(
      createReflector({ [IS_PUBLIC_KEY]: true, [ROLES_KEY]: ['LIVREUR'] }),
    );
    expect(guard.canActivate(createHttpContext({}))).toBe(true);
  });
});

describe('PermissionsGuard', () => {
  const hasAll = jest.fn<Promise<boolean>, [string | null, string, readonly string[]]>();
  const permissions = { hasAll } as unknown as PermissionsService;

  beforeEach(() => hasAll.mockReset());

  it('vérifie les permissions en base pour le traiteur et le rôle du jeton', async () => {
    hasAll.mockResolvedValue(true);
    const guard = new PermissionsGuard(
      createReflector({ [PERMISSIONS_KEY]: ['orders.read'] }),
      permissions,
    );
    const user = buildUser();
    await expect(guard.canActivate(createHttpContext({ user }))).resolves.toBe(true);
    expect(hasAll).toHaveBeenCalledWith(user.traiteurId, 'EMPLOYE', ['orders.read']);
  });

  it('refuse si une permission manque', async () => {
    hasAll.mockResolvedValue(false);
    const guard = new PermissionsGuard(
      createReflector({ [PERMISSIONS_KEY]: ['invoices.issue'] }),
      permissions,
    );
    await expectErrorCode(
      guard.canActivate(createHttpContext({ user: buildUser() })),
      'MISSING_PERMISSION',
    );
  });

  it('ne consulte pas la base pour le SUPER_ADMIN', async () => {
    const guard = new PermissionsGuard(
      createReflector({ [PERMISSIONS_KEY]: ['invoices.issue'] }),
      permissions,
    );
    const user = buildUser({ role: 'SUPER_ADMIN', isSuperAdmin: true });
    await expect(guard.canActivate(createHttpContext({ user }))).resolves.toBe(true);
    expect(hasAll).not.toHaveBeenCalled();
  });
});

describe('FeatureGuard', () => {
  const isEnabled = jest.fn<Promise<boolean>, [string, string]>();
  const features = { isEnabled } as unknown as FeaturesService;

  it('autorise si la fonctionnalité est incluse dans l’offre', async () => {
    isEnabled.mockResolvedValue(true);
    const guard = new FeatureGuard(createReflector({ [FEATURE_KEY]: 'quotes' }), features);
    await expect(guard.canActivate(createHttpContext({ user: buildUser() }))).resolves.toBe(true);
  });

  it('refuse si la fonctionnalité est désactivée', async () => {
    isEnabled.mockResolvedValue(false);
    const guard = new FeatureGuard(createReflector({ [FEATURE_KEY]: 'chatbot' }), features);
    await expectErrorCode(
      guard.canActivate(createHttpContext({ user: buildUser() })),
      'FEATURE_DISABLED',
    );
  });
});

describe('TenantGuard', () => {
  type MembershipRow = {
    role: string;
    status: string;
    user: { status: string };
    traiteur: { status: string };
  } | null;
  const findFirst = jest.fn<Promise<MembershipRow>, [unknown]>();
  const findUnique = jest.fn<
    Promise<{ status: string; isSuperAdmin: boolean } | null>,
    [unknown]
  >();
  const prisma = {
    membership: { findFirst },
    user: { findUnique },
  } as unknown as PrismaService;
  const guard = new TenantGuard(createReflector({}), prisma);

  const activeMembership = {
    role: 'EMPLOYE',
    status: 'ACTIVE',
    user: { status: 'ACTIVE' },
    traiteur: { status: 'ACTIVE' },
  };

  beforeEach(() => {
    findFirst.mockReset();
    findUnique.mockReset();
  });

  it('autorise un membre actif et vérifie le Membership du jeton', async () => {
    findFirst.mockResolvedValue(activeMembership);
    const user = buildUser();
    await expect(guard.canActivate(createHttpContext({ user }))).resolves.toBe(true);
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: user.membershipId, userId: user.userId, traiteurId: user.traiteurId },
      }),
    );
  });

  it('refuse un :traiteurId de route différent de celui du jeton', async () => {
    findFirst.mockResolvedValue(activeMembership);
    const context = createHttpContext({
      user: buildUser(),
      params: { traiteurId: '99999999-9999-4999-8999-999999999999' },
    });
    await expectErrorCode(guard.canActivate(context), 'TENANT_MISMATCH');
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('refuse un Membership suspendu ou dont le rôle a changé', async () => {
    findFirst.mockResolvedValue({ ...activeMembership, status: 'SUSPENDED' });
    await expectErrorCode(
      guard.canActivate(createHttpContext({ user: buildUser() })),
      'MEMBERSHIP_INACTIVE',
    );
    findFirst.mockResolvedValue({ ...activeMembership, role: 'CLIENT' });
    await expectErrorCode(
      guard.canActivate(createHttpContext({ user: buildUser() })),
      'MEMBERSHIP_INACTIVE',
    );
  });

  it('refuse un Membership introuvable (jeton d’un autre traiteur)', async () => {
    findFirst.mockResolvedValue(null);
    await expectErrorCode(
      guard.canActivate(createHttpContext({ user: buildUser() })),
      'ACCOUNT_DISABLED',
    );
  });

  it('refuse l’accès à un traiteur suspendu', async () => {
    findFirst.mockResolvedValue({ ...activeMembership, traiteur: { status: 'SUSPENDED' } });
    await expectErrorCode(
      guard.canActivate(createHttpContext({ user: buildUser() })),
      'TRAITEUR_UNAVAILABLE',
    );
  });

  it('refuse un jeton sans traiteur pour un utilisateur non SUPER_ADMIN', async () => {
    const user = buildUser({ traiteurId: null, membershipId: null });
    await expectErrorCode(guard.canActivate(createHttpContext({ user })), 'TRAITEUR_REQUIRED');
  });

  it('laisse passer un SUPER_ADMIN actif', async () => {
    findUnique.mockResolvedValue({ status: 'ACTIVE', isSuperAdmin: true });
    const user = buildUser({ role: 'SUPER_ADMIN', isSuperAdmin: true, membershipId: null });
    await expect(guard.canActivate(createHttpContext({ user }))).resolves.toBe(true);
  });

  it('refuse un jeton SUPER_ADMIN dont le compte a perdu ce statut', async () => {
    findUnique.mockResolvedValue({ status: 'ACTIVE', isSuperAdmin: false });
    const user = buildUser({ role: 'SUPER_ADMIN', isSuperAdmin: true });
    await expectErrorCode(guard.canActivate(createHttpContext({ user })), 'ACCOUNT_DISABLED');
  });
});
