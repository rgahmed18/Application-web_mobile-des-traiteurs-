import { runInNewContext } from 'node:vm';

import { afterEach, describe, expect, it } from 'vitest';

import { publicEnv, publicEnvScript, serverPublicEnv } from './public';

describe('variables publiques lues au démarrage', () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'window');
  });

  it('serveur : lit l’environnement du processus, avec des valeurs par défaut', () => {
    expect(
      serverPublicEnv({
        PUBLIC_API_URL: 'https://app.exemple.ma/api/v1',
        PUBLIC_MEDIA_URL: 'https://media.exemple.ma',
      } as NodeJS.ProcessEnv),
    ).toEqual({
      PUBLIC_API_URL: 'https://app.exemple.ma/api/v1',
      PUBLIC_MEDIA_URL: 'https://media.exemple.ma',
    });
    expect(serverPublicEnv({} as NodeJS.ProcessEnv).PUBLIC_API_URL).toBe(
      'http://localhost:3000/api/v1',
    );
    expect(() => serverPublicEnv({ PUBLIC_API_URL: 'pas une url' } as NodeJS.ProcessEnv)).toThrow(
      /PUBLIC_API_URL/,
    );
  });

  it('script de la page : JSON échappé, impossible d’en sortir par une balise', () => {
    const script = publicEnvScript({
      PUBLIC_API_URL: 'https://app.exemple.ma/api/v1',
      PUBLIC_MEDIA_URL: 'https://media.exemple.ma/</script><script>alert(1)</script>',
    });
    expect(script).not.toContain('</script>');
    expect(script.startsWith('window.__PUBLIC_ENV__={')).toBe(true);
    // Le navigateur relit exactement les valeurs publiées
    const sandbox: { window: { __PUBLIC_ENV__?: unknown } } = { window: {} };
    runInNewContext(script, sandbox);
    expect(sandbox.window.__PUBLIC_ENV__).toMatchObject({
      PUBLIC_MEDIA_URL: 'https://media.exemple.ma/</script><script>alert(1)</script>',
    });
  });

  it('navigateur : lit les valeurs publiées dans la page', () => {
    const published = {
      PUBLIC_API_URL: 'https://staging.exemple.ma/api/v1',
      PUBLIC_MEDIA_URL: 'https://media-staging.exemple.ma',
    };
    Object.assign(globalThis, { window: { __PUBLIC_ENV__: published } });
    expect(publicEnv()).toEqual(published);
  });
});
