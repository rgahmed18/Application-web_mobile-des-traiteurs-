import type { ConfigService } from '@nestjs/config';

import { getErrorCode } from '../../common/errors';
import type { Env } from '../../config/env.schema';
import type { OtpPurpose } from '../../generated/prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import { OtpService } from './otp.service';
import type { SmsProvider } from './sms.provider';

interface OtpRow {
  id: string;
  phone: string;
  purpose: OtpPurpose;
  codeHash: string;
  expiresAt: Date;
  attempts: number;
  maxAttempts: number;
  usedAt: Date | null;
  createdAt: Date;
}

interface OtpWhere {
  id?: string;
  phone?: string;
  purpose?: OtpPurpose;
  usedAt?: null;
  expiresAt?: { gt: Date };
  createdAt?: { gt: Date };
  attempts?: { lt: number };
}

/** Stockage OTP en mémoire reproduisant la sémantique des requêtes Prisma utilisées. */
class InMemoryOtpStore {
  rows: OtpRow[] = [];
  private sequence = 0;

  private matches(row: OtpRow, where: OtpWhere): boolean {
    return (
      (where.id === undefined || row.id === where.id) &&
      (where.phone === undefined || row.phone === where.phone) &&
      (where.purpose === undefined || row.purpose === where.purpose) &&
      (where.usedAt === undefined || row.usedAt === null) &&
      (where.expiresAt === undefined || row.expiresAt > where.expiresAt.gt) &&
      (where.createdAt === undefined || row.createdAt > where.createdAt.gt) &&
      (where.attempts === undefined || row.attempts < where.attempts.lt)
    );
  }

  private sorted(where: OtpWhere): OtpRow[] {
    return this.rows
      .filter((row) => this.matches(row, where))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  readonly otpCode = {
    findMany: ({ where }: { where: OtpWhere }) => Promise.resolve(this.sorted(where)),
    findFirst: ({ where }: { where: OtpWhere }) => Promise.resolve(this.sorted(where)[0] ?? null),
    create: ({ data }: { data: Omit<OtpRow, 'id' | 'attempts' | 'usedAt' | 'createdAt'> }) => {
      this.sequence += 1;
      const row: OtpRow = {
        ...data,
        id: `otp-${this.sequence}`,
        attempts: 0,
        usedAt: null,
        createdAt: new Date(Date.now() + this.sequence), // ordre de création stable
      };
      this.rows.push(row);
      return Promise.resolve(row);
    },
    updateMany: ({
      where,
      data,
    }: {
      where: OtpWhere;
      data: { attempts?: { increment: number }; usedAt?: Date; expiresAt?: Date };
    }) => {
      const targets = this.rows.filter((row) => this.matches(row, where));
      for (const row of targets) {
        if (data.attempts) row.attempts += data.attempts.increment;
        if (data.usedAt) row.usedAt = data.usedAt;
        if (data.expiresAt) row.expiresAt = data.expiresAt;
      }
      return Promise.resolve({ count: targets.length });
    },
  };

  $transaction = (operations: Promise<unknown>[]) => Promise.all(operations);
}

const settings: Partial<Env> = {
  OTP_TTL_SECONDS: 300,
  OTP_MAX_ATTEMPTS: 3,
  OTP_RESEND_COOLDOWN_SECONDS: 60,
  OTP_MAX_PER_HOUR: 5,
  OTP_SECRET: 'x'.repeat(32),
};
const config = {
  get: (key: keyof Env) => settings[key],
} as unknown as ConfigService<Env, true>;

const PHONE = '+212612345678';

function setup() {
  const store = new InMemoryOtpStore();
  const sent: string[] = [];
  const sms: SmsProvider = {
    send: (_phone, message) => {
      sent.push(message);
      return Promise.resolve();
    },
  };
  const service = new OtpService(store as unknown as PrismaService, sms, config);
  const lastCode = () => /(\d{6})/.exec(sent.at(-1) ?? '')?.[1] ?? '';
  return { store, sent, service, lastCode };
}

async function errorCodeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return getErrorCode(error);
  }
  return undefined;
}

describe('OtpService', () => {
  beforeEach(() => jest.useRealTimers());

  it('génère un code à 6 chiffres', () => {
    const { service } = setup();
    for (let i = 0; i < 50; i += 1) expect(service.generateCode()).toMatch(/^\d{6}$/);
  });

  it('ne stocke que le hash, lié au numéro et à l’usage', async () => {
    const { store, service, lastCode } = setup();
    await service.requestCode(PHONE, 'LOGIN');
    const code = lastCode();
    expect(store.rows[0]?.codeHash).not.toContain(code);
    expect(service.hashCode(PHONE, 'LOGIN', code)).toBe(store.rows[0]?.codeHash);
    expect(service.hashCode(PHONE, 'PASSWORD_RESET', code)).not.toBe(store.rows[0]?.codeHash);
  });

  it('accepte le bon code une seule fois', async () => {
    const { service, lastCode } = setup();
    await service.requestCode(PHONE, 'LOGIN');
    const code = lastCode();
    await expect(service.verifyCode(PHONE, 'LOGIN', code)).resolves.toBeUndefined();
    expect(await errorCodeOf(service.verifyCode(PHONE, 'LOGIN', code))).toBe('INVALID_OTP');
  });

  it('checkCode valide sans consommer ; consumeCode consomme une seule fois', async () => {
    const { service, lastCode } = setup();
    await service.requestCode(PHONE, 'LOGIN');
    const code = lastCode();
    const otpId = await service.checkCode(PHONE, 'LOGIN', code);
    // Toujours valide : la vérification n'a rien consommé
    await expect(service.checkCode(PHONE, 'LOGIN', code)).resolves.toBe(otpId);
    await service.consumeCode(otpId);
    expect(await errorCodeOf(service.consumeCode(otpId))).toBe('INVALID_OTP');
    expect(await errorCodeOf(service.checkCode(PHONE, 'LOGIN', code))).toBe('INVALID_OTP');
  });

  it('refuse un code destiné à un autre usage', async () => {
    const { service, lastCode } = setup();
    await service.requestCode(PHONE, 'PASSWORD_RESET');
    expect(await errorCodeOf(service.verifyCode(PHONE, 'LOGIN', lastCode()))).toBe('INVALID_OTP');
  });

  it('verrouille le code après le nombre maximal de tentatives, même avec le bon code ensuite', async () => {
    const { service, lastCode } = setup();
    await service.requestCode(PHONE, 'LOGIN');
    const code = lastCode();
    const wrong = code === '000000' ? '111111' : '000000';

    for (let i = 0; i < 3; i += 1) {
      expect(await errorCodeOf(service.verifyCode(PHONE, 'LOGIN', wrong))).toBe('INVALID_OTP');
    }
    expect(await errorCodeOf(service.verifyCode(PHONE, 'LOGIN', code))).toBe('OTP_LOCKED');
  });

  it('refuse un code expiré', async () => {
    const { store, service, lastCode } = setup();
    await service.requestCode(PHONE, 'LOGIN');
    const row = store.rows[0];
    if (row) row.expiresAt = new Date(Date.now() - 1000);
    expect(await errorCodeOf(service.verifyCode(PHONE, 'LOGIN', lastCode()))).toBe('INVALID_OTP');
  });

  it('impose un délai entre deux demandes pour le même usage', async () => {
    const { service } = setup();
    await service.requestCode(PHONE, 'LOGIN');
    expect(await errorCodeOf(service.requestCode(PHONE, 'LOGIN'))).toBe('OTP_RATE_LIMITED');
  });

  it('invalide l’ancien code quand un nouveau est demandé', async () => {
    const { store, service, sent, lastCode } = setup();
    await service.requestCode(PHONE, 'LOGIN');
    const firstCode = lastCode();
    // Simule le délai de renvoi écoulé
    for (const row of store.rows) row.createdAt = new Date(Date.now() - 120_000);
    await service.requestCode(PHONE, 'LOGIN');
    expect(sent).toHaveLength(2);
    if (firstCode !== lastCode()) {
      expect(await errorCodeOf(service.verifyCode(PHONE, 'LOGIN', firstCode))).toBe('INVALID_OTP');
    }
    await expect(service.verifyCode(PHONE, 'LOGIN', lastCode())).resolves.toBeUndefined();
  });

  it('limite le nombre de codes par heure et par numéro', async () => {
    const { store, service } = setup();
    for (let i = 0; i < 5; i += 1) {
      await service.requestCode(PHONE, i % 2 === 0 ? 'LOGIN' : 'SIGNUP');
      for (const row of store.rows) row.createdAt = new Date(Date.now() - 120_000);
    }
    expect(await errorCodeOf(service.requestCode(PHONE, 'PASSWORD_RESET'))).toBe(
      'OTP_RATE_LIMITED',
    );
  });

  it('n’envoie pas de SMS quand deliver = false (anti-énumération)', async () => {
    const { service, sent, store } = setup();
    const response = await service.requestCode(PHONE, 'PASSWORD_RESET', { deliver: false });
    expect(sent).toHaveLength(0);
    expect(store.rows).toHaveLength(1);
    expect(response).toEqual({ retryAfterSeconds: 60, expiresInSeconds: 300 });
  });
});
