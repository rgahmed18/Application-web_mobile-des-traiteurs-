import type { PermissionsService } from '../access/permissions.service';
import { getErrorCode } from '../common/errors';
import type { User } from '../generated/prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';
import type { OtpService } from './otp/otp.service';
import type { PasswordService } from './password.service';
import type { TokenService } from './token.service';

const TRAITEUR = {
  id: '22222222-2222-4222-8222-222222222222',
  slug: 'dar-diafa',
  status: 'ACTIVE',
};
const client = { ipAddress: '127.0.0.1', userAgent: 'jest' };

function buildUser(overrides: Partial<User> = {}): User {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    phone: '+212612345678',
    email: 'client@exemple.ma',
    passwordHash: 'hash',
    firstName: 'Salma',
    lastName: 'Bennani',
    locale: 'fr',
    status: 'ACTIVE',
    isSuperAdmin: false,
    lastLoginAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

interface MembershipRow {
  id: string;
  role: string;
  status: string;
}

function setup(options: {
  user?: User | null;
  membership?: MembershipRow | null;
  passwordValid?: boolean;
}) {
  const membershipCreate = jest.fn((args: { data: { role: string } }) =>
    Promise.resolve({ id: 'new-membership', role: args.data.role, status: 'ACTIVE' }),
  );
  const userCreate = jest.fn((args: { data: Partial<User> }) =>
    Promise.resolve(buildUser({ ...args.data, id: 'new-user' })),
  );
  const prisma = {
    user: {
      findUnique: jest.fn(() => Promise.resolve(options.user ?? null)),
      create: userCreate,
      update: jest.fn(() => Promise.resolve()),
    },
    traiteur: { findUnique: jest.fn(() => Promise.resolve(TRAITEUR)) },
    membership: {
      findUnique: jest.fn(() => Promise.resolve(options.membership ?? null)),
      create: membershipCreate,
      update: jest.fn((args: { data: { status: string } }) =>
        Promise.resolve({ id: 'm1', role: 'EMPLOYE', status: args.data.status }),
      ),
    },
  };
  const passwords = {
    verify: jest.fn(() => Promise.resolve(options.passwordValid ?? true)),
    verifyAgainstDummy: jest.fn(() => Promise.resolve(false)),
    hash: jest.fn(() => Promise.resolve('new-hash')),
  };
  const tokens = {
    issueTokens: jest.fn(() =>
      Promise.resolve({ accessToken: 'access', refreshToken: 'refresh', expiresIn: 900 }),
    ),
    revokeAllForUser: jest.fn(() => Promise.resolve()),
  };
  const otp = {
    verifyCode: jest.fn(() => Promise.resolve()),
    checkCode: jest.fn(() => Promise.resolve('otp-1')),
    consumeCode: jest.fn(() => Promise.resolve()),
    requestCode: jest.fn(() => Promise.resolve({ retryAfterSeconds: 60, expiresInSeconds: 300 })),
  };
  const service = new AuthService(
    prisma as unknown as PrismaService,
    passwords as unknown as PasswordService,
    tokens as unknown as TokenService,
    otp as unknown as OtpService,
    {} as PermissionsService,
  );
  return { service, prisma, passwords, otp, tokens, membershipCreate, userCreate };
}

async function errorCodeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return getErrorCode(error);
  }
  return undefined;
}

describe('AuthService.login', () => {
  const input = { identifier: '0612345678', password: 'Password123!', traiteurSlug: 'dar-diafa' };

  it('connecte un membre actif avec le rôle de son Membership', async () => {
    const { service } = setup({
      user: buildUser(),
      membership: { id: 'm1', role: 'EMPLOYE', status: 'ACTIVE' },
    });
    const session = await service.login(input, client);
    expect(session.context).toEqual({
      traiteurId: TRAITEUR.id,
      membershipId: 'm1',
      role: 'EMPLOYE',
    });
    expect(session.user.hasPassword).toBe(true);
  });

  it('refuse un mauvais mot de passe avec un message générique', async () => {
    const { service } = setup({ user: buildUser(), passwordValid: false });
    expect(await errorCodeOf(service.login(input, client))).toBe('INVALID_CREDENTIALS');
  });

  it('vérifie un hash factice si le compte n’existe pas (temps constant)', async () => {
    const { service, passwords } = setup({ user: null });
    expect(await errorCodeOf(service.login(input, client))).toBe('INVALID_CREDENTIALS');
    expect(passwords.verifyAgainstDummy).toHaveBeenCalled();
  });

  it('refuse la connexion par mot de passe d’un compte sans mot de passe (OTP seulement)', async () => {
    const { service, passwords } = setup({ user: buildUser({ passwordHash: null }) });
    expect(await errorCodeOf(service.login(input, client))).toBe('INVALID_CREDENTIALS');
    expect(passwords.verifyAgainstDummy).toHaveBeenCalled();
  });

  it('refuse un compte désactivé', async () => {
    const { service } = setup({ user: buildUser({ status: 'DISABLED' }) });
    expect(await errorCodeOf(service.login(input, client))).toBe('ACCOUNT_DISABLED');
  });

  it('exige un traiteur pour un utilisateur non SUPER_ADMIN', async () => {
    const { service } = setup({ user: buildUser() });
    const { traiteurSlug: _ignored, ...withoutTraiteur } = input;
    expect(await errorCodeOf(service.login(withoutTraiteur, client))).toBe('TRAITEUR_REQUIRED');
  });

  it('connecte le SUPER_ADMIN en contexte plateforme sans traiteur', async () => {
    const { service } = setup({ user: buildUser({ isSuperAdmin: true }) });
    const session = await service.login({ identifier: 'admin@x.ma', password: 'x' }, client);
    expect(session.context).toEqual({ traiteurId: null, membershipId: null, role: 'SUPER_ADMIN' });
  });

  it('inscrit automatiquement comme CLIENT un utilisateur nouveau chez ce traiteur', async () => {
    const { service, membershipCreate } = setup({ user: buildUser(), membership: null });
    const session = await service.login(input, client);
    expect(membershipCreate).toHaveBeenCalledWith({
      data: { userId: buildUser().id, traiteurId: TRAITEUR.id, role: 'CLIENT' },
    });
    expect(session.context.role).toBe('CLIENT');
  });

  it('refuse un Membership suspendu', async () => {
    const { service } = setup({
      user: buildUser(),
      membership: { id: 'm1', role: 'EMPLOYE', status: 'SUSPENDED' },
    });
    expect(await errorCodeOf(service.login(input, client))).toBe('MEMBERSHIP_INACTIVE');
  });

  it('active un Membership invité à la première connexion', async () => {
    const { service, prisma } = setup({
      user: buildUser(),
      membership: { id: 'm1', role: 'EMPLOYE', status: 'INVITED' },
    });
    await service.login(input, client);
    expect(prisma.membership.update).toHaveBeenCalledWith({
      where: { id: 'm1' },
      data: { status: 'ACTIVE' },
    });
  });
});

describe('AuthService.register', () => {
  const input = {
    traiteurSlug: 'dar-diafa',
    phone: '+212612345678',
    code: '123456',
    password: 'Password123!',
    firstName: 'Salma',
    lastName: 'Bennani',
  };

  it('vérifie le code SMS SIGNUP avant de créer le compte', async () => {
    const { service, otp, userCreate } = setup({ user: null });
    await service.register(input, client).catch(() => undefined);
    expect(otp.verifyCode).toHaveBeenCalledWith(input.phone, 'SIGNUP', '123456');
    expect(userCreate).toHaveBeenCalled();
  });

  it('refuse un numéro déjà inscrit', async () => {
    const { service, userCreate } = setup({ user: buildUser() });
    expect(await errorCodeOf(service.register(input, client))).toBe('ACCOUNT_EXISTS');
    expect(userCreate).not.toHaveBeenCalled();
  });
});

describe('AuthService.verifyOtp', () => {
  const input = { traiteurSlug: 'dar-diafa', phone: '+212612345678', code: '123456' };

  it('exige prénom et nom pour un compte inconnu, sans consommer le code', async () => {
    const { service, otp } = setup({ user: null });
    expect(await errorCodeOf(service.verifyOtp(input, client))).toBe('PROFILE_REQUIRED');
    expect(otp.checkCode).toHaveBeenCalledWith(input.phone, 'LOGIN', '123456');
    expect(otp.consumeCode).not.toHaveBeenCalled();
  });

  it('consomme le code pour un compte existant', async () => {
    const { service, otp } = setup({
      user: buildUser(),
      membership: { id: 'm1', role: 'CLIENT', status: 'ACTIVE' },
    });
    await service.verifyOtp(input, client);
    expect(otp.consumeCode).toHaveBeenCalledWith('otp-1');
  });

  it('crée un compte sans mot de passe si le profil est fourni', async () => {
    const { service, userCreate } = setup({ user: null, membership: null });
    const session = await service.verifyOtp(
      { ...input, firstName: 'Youssef', lastName: 'Alami' },
      client,
    );
    expect(userCreate).toHaveBeenCalledWith({
      data: expect.not.objectContaining({ passwordHash: expect.anything() as unknown }) as unknown,
    });
    expect(session.context.role).toBe('CLIENT');
  });
});

describe('AuthService.resetPassword', () => {
  it('change le mot de passe et révoque toutes les sessions', async () => {
    const { service, tokens, otp } = setup({ user: buildUser() });
    await service.resetPassword({
      phone: '+212612345678',
      code: '123456',
      newPassword: 'Nouveau123',
    });
    expect(otp.verifyCode).toHaveBeenCalledWith('+212612345678', 'PASSWORD_RESET', '123456');
    expect(tokens.revokeAllForUser).toHaveBeenCalledWith(buildUser().id);
  });
});
