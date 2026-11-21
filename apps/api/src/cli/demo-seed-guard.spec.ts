import { DemoSeedRefused, demoSeedPlan, LOCAL_DEMO_PASSWORD } from './demo-seed-guard';

const STRONG = 'staging-demo-7f3a9c21';

describe('garde du seed de démonstration', () => {
  it('développement et tests : autorisé, mot de passe habituel et super admin de démo', () => {
    expect(demoSeedPlan({})).toEqual({ password: LOCAL_DEMO_PASSWORD, withSuperAdmin: true });
    expect(demoSeedPlan({ NODE_ENV: 'test' }).withSuperAdmin).toBe(true);
    expect(demoSeedPlan({ NODE_ENV: 'development', APP_ENV: 'development' }).password).toBe(
      LOCAL_DEMO_PASSWORD,
    );
  });

  it.each([
    { APP_ENV: 'production' },
    { ENVIRONMENT: 'production' },
    { SENTRY_ENVIRONMENT: 'production' },
    { APP_ENV: 'Production ' },
    { APP_ENV: 'prod' },
    // Même avec tous les opt-in : la production n'a aucune exception
    {
      APP_ENV: 'production',
      NODE_ENV: 'production',
      ALLOW_STAGING_DEMO_SEED: 'true',
      ALLOW_DEMO_SEED: 'true',
      DEMO_SEED_PASSWORD: STRONG,
    },
    // APP_ENV prime sur ENVIRONMENT
    { APP_ENV: 'production', ENVIRONMENT: 'staging', ALLOW_STAGING_DEMO_SEED: 'true' },
  ])('production : toujours refusé (%o)', (env) => {
    expect(() => demoSeedPlan(env)).toThrow(DemoSeedRefused);
    expect(() => demoSeedPlan(env)).toThrow(/production/);
  });

  it('NODE_ENV=production sans environnement déclaré : refusé, ancien ALLOW_DEMO_SEED ignoré', () => {
    expect(() => demoSeedPlan({ NODE_ENV: 'production' })).toThrow(DemoSeedRefused);
    expect(() => demoSeedPlan({ NODE_ENV: 'production', ALLOW_DEMO_SEED: 'true' })).toThrow(
      DemoSeedRefused,
    );
  });

  it('staging : refusé sans l’opt-in dédié', () => {
    expect(() => demoSeedPlan({ NODE_ENV: 'production', APP_ENV: 'staging' })).toThrow(
      /ALLOW_STAGING_DEMO_SEED/,
    );
    expect(() =>
      demoSeedPlan({ NODE_ENV: 'production', ENVIRONMENT: 'staging', ALLOW_DEMO_SEED: 'true' }),
    ).toThrow(DemoSeedRefused);
  });

  it('staging avec opt-in : mot de passe propre au serveur exigé, jamais de super admin', () => {
    const base = {
      NODE_ENV: 'production',
      ENVIRONMENT: 'staging',
      ALLOW_STAGING_DEMO_SEED: 'true',
    };
    expect(() => demoSeedPlan(base)).toThrow(/DEMO_SEED_PASSWORD/);
    expect(() => demoSeedPlan({ ...base, DEMO_SEED_PASSWORD: 'court' })).toThrow(DemoSeedRefused);
    expect(() => demoSeedPlan({ ...base, DEMO_SEED_PASSWORD: LOCAL_DEMO_PASSWORD })).toThrow(
      DemoSeedRefused,
    );
    expect(demoSeedPlan({ ...base, DEMO_SEED_PASSWORD: STRONG })).toEqual({
      password: STRONG,
      withSuperAdmin: false,
    });
  });
});
