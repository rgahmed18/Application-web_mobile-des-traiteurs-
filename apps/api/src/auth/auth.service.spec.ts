import type { ConfigService } from '@nestjs/config';

import type { PermissionsService } from '../access/permissions.service';
import type { AuditEntry, AuditService } from '../audit/audit.service';
import { getErrorCode } from '../common/errors';
import type { Env } from '../config/env.schema';
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
    failedLoginCount: 0,
    lockedUntil: null,
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
  // Utilisateur stocké : les mises à jour (compteur d'échecs, verrouillage) sont réellement appliquées
  let stored: User | null = options.user ? { ...options.user } : null;
  const userCreate = jest.fn((args: { data: Partial<User> }) => {
    stored = buildUser({ ...args.data, id: 'new-user' });
    return Promise.resolve({ ...stored });
  });
  const userUpdate = jest.fn(
    (args: {
      data: {
        failedLoginCount?: number | { increment: number };
        lockedUntil?: Date | null;
        passwordHash?: string;
      };
    }) => {
      if (!stored) throw new Error('utilisateur absent');
      const { failedLoginCount, lockedUntil, passwordHash } = args.data;
      if (typeof failedLoginCount === 'number') stored.failedLoginCount = failedLoginCount;
      else if (failedLoginCount) stored.failedLoginCount += failedLoginCount.increment;
      if (lockedUntil !== undefined) stored.lockedUntil = lockedUntil;
      if (passwordHash !== undefined) stored.passwordHash = passwordHash;
      return Promise.resolve({ ...stored });
    },
  );
  const prisma = {
    user: {
      findUnique: jest.fn(() => Promise.resolve(stored ? { ...stored } : null)),
      create: userCreate,
      update: userUpdate,
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
  const auditEntries: AuditEntry[] = [];
  const audit = {
    record: (entry: AuditEntry) => {
      auditEntries.push(entry);
      return Promise.resolve();
    },
  };
  const settings: Partial<Env> = { LOGIN_MAX_FAILURES: 5, LOGIN_LOCKOUT_MINUTES: [1, 5, 15] };
  const config = { get: (key: keyof Env) => settings[key] } as unknown as ConfigService<Env, true>;
  const service = new AuthService(
    prisma as unknown as PrismaService,
    passwords as unknown as PasswordService,
    tokens as unknown as TokenService,
    otp as unknown as OtpService,
    {} as PermissionsService,
    audit as unknown as AuditService,
    config,
  );
  const getStored = () => stored;
  return {
    service,
    prisma,
    passwords,
    otp,
    tokens,
    membershipCreate,
    userCreate,
    auditEntries,
    getStored,
  };
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
      // Coordonnées propres au traiteur, initialisées depuis le compte
      data: {
        userId: buildUser().id,
        traiteurId: TRAITEUR.id,
        role: 'CLIENT',
        firstName: 'Salma',
        lastName: 'Bennani',
        email: 'client@exemple.ma',
        locale: 'fr',
      },
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

  it('vérifie le code SIGNUP, puis le consomme avant de créer le compte', async () => {
    const { service, otp, userCreate } = setup({ user: null });
    await service.register(input, client).catch(() => undefined);
    expect(otp.checkCode).toHaveBeenCalledWith(input.phone, 'SIGNUP', '123456');
    expect(otp.consumeCode).toHaveBeenCalledWith('otp-1');
    expect(userCreate).toHaveBeenCalled();
  });

  it('refuse un numéro déjà inscrit sans consommer le code', async () => {
    const { service, otp, userCreate } = setup({ user: buildUser() });
    expect(await errorCodeOf(service.register(input, client))).toBe('ACCOUNT_EXISTS');
    expect(otp.checkCode).toHaveBeenCalled();
    expect(otp.consumeCode).not.toHaveBeenCalled();
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
  it('change le mot de passe, révoque les sessions et lève le verrouillage', async () => {
    const lockedUntil = new Date(Date.now() + 60_000);
    const { service, tokens, otp, getStored, auditEntries } = setup({
      user: buildUser({ failedLoginCount: 7, lockedUntil }),
    });
    await service.resetPassword(
      { phone: '+212612345678', code: '123456', newPassword: 'Nouveau123' },
      client,
    );
    expect(getStored()).toMatchObject({ failedLoginCount: 0, lockedUntil: null });
    expect(auditEntries.map((entry) => entry.action)).toEqual(['auth.password_reset']);
    expect(otp.verifyCode).toHaveBeenCalledWith('+212612345678', 'PASSWORD_RESET', '123456');
    expect(tokens.revokeAllForUser).toHaveBeenCalledWith(buildUser().id);
  });
});

describe('AuthService.login — verrouillage progressif', () => {
  const input = { identifier: '0612345678', password: 'Mauvais1', traiteurSlug: 'dar-diafa' };

  async function failTimes(service: AuthService, times: number): Promise<void> {
    for (let i = 0; i < times; i += 1) {
      expect(await errorCodeOf(service.login(input, client))).toBe('INVALID_CREDENTIALS');
    }
  }

  it('compte les échecs et verrouille 1 min au 5e, en traçant chaque événement', async () => {
    const { service, getStored, auditEntries } = setup({
      user: buildUser(),
      passwordValid: false,
    });
    await failTimes(service, 4);
    expect(getStored()).toMatchObject({ failedLoginCount: 4, lockedUntil: null });

    const before = Date.now();
    await failTimes(service, 1);
    const lockedUntil = getStored()?.lockedUntil;
    expect(getStored()?.failedLoginCount).toBe(5);
    expect(lockedUntil?.getTime()).toBeGreaterThanOrEqual(before + 60_000);
    expect(lockedUntil?.getTime()).toBeLessThan(before + 61_000);

    const actions = auditEntries.map((entry) => entry.action);
    expect(actions.filter((action) => action === 'auth.login_failed')).toHaveLength(5);
    expect(actions.at(-1)).toBe('auth.account_locked');
    expect(auditEntries.every((entry) => entry.entityId === buildUser().id)).toBe(true);
    expect(auditEntries[0]?.client).toEqual(client);
  });

  it('refuse un compte verrouillé même avec le bon mot de passe, sans vérifier ce dernier', async () => {
    const lockedUntil = new Date(Date.now() + 60_000);
    const { service, passwords, auditEntries } = setup({
      user: buildUser({ failedLoginCount: 5, lockedUntil }),
      passwordValid: true,
    });
    expect(await errorCodeOf(service.login({ ...input, password: 'Password123!' }, client))).toBe(
      'INVALID_CREDENTIALS',
    );
    expect(passwords.verify).not.toHaveBeenCalled();
    expect(passwords.verifyAgainstDummy).toHaveBeenCalled(); // temps de réponse constant
    expect(auditEntries.map((entry) => entry.action)).toEqual(['auth.login_blocked']);
  });

  it('répond exactement pareil pour un compte verrouillé et un compte inexistant', async () => {
    const locked = setup({
      user: buildUser({ failedLoginCount: 5, lockedUntil: new Date(Date.now() + 60_000) }),
    });
    const unknown = setup({ user: null });
    const responseOf = async (service: AuthService) => {
      try {
        await service.login(input, client);
      } catch (error) {
        return error instanceof Error && 'getResponse' in error
          ? JSON.stringify((error as { getResponse: () => unknown }).getResponse())
          : String(error);
      }
      return 'succès';
    };
    expect(await responseOf(locked.service)).toBe(await responseOf(unknown.service));
  });

  it('allonge le verrouillage à chaque nouvel échec après expiration (1, 5 puis 15 min)', async () => {
    const { service, getStored } = setup({
      user: buildUser({ failedLoginCount: 5, lockedUntil: new Date(Date.now() - 1_000) }),
      passwordValid: false,
    });
    const before = Date.now();
    await failTimes(service, 1);
    expect(getStored()?.lockedUntil?.getTime()).toBeGreaterThanOrEqual(before + 5 * 60_000);
  });

  it('ne compte pas les tentatives faites pendant le verrouillage', async () => {
    const lockedUntil = new Date(Date.now() + 60_000);
    const { service, getStored } = setup({
      user: buildUser({ failedLoginCount: 5, lockedUntil }),
      passwordValid: false,
    });
    await failTimes(service, 3);
    expect(getStored()).toMatchObject({ failedLoginCount: 5, lockedUntil });
  });

  it('remet le compteur à zéro après une connexion réussie', async () => {
    const { service, getStored } = setup({
      user: buildUser({ failedLoginCount: 3 }),
      membership: { id: 'm1', role: 'CLIENT', status: 'ACTIVE' },
      passwordValid: true,
    });
    await service.login({ ...input, password: 'Password123!' }, client);
    expect(getStored()).toMatchObject({ failedLoginCount: 0, lockedUntil: null });
  });

  it('ne trace rien et ne crée rien pour un identifiant inconnu', async () => {
    const { service, auditEntries } = setup({ user: null });
    await failTimes(service, 3);
    expect(auditEntries).toHaveLength(0);
  });
});
