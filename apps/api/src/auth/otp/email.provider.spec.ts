import {
  ConsoleEmailProvider,
  createEmailProvider,
  DisabledEmailProvider,
  fillEmailTemplate,
  HttpEmailProvider,
  maskEmail,
} from './email.provider';

const base = {
  EMAIL_HTTP_AUTH_HEADER_NAME: 'api-key',
  EMAIL_TIMEOUT_MS: 5_000,
} as const;

describe('Fournisseur d’e-mails', () => {
  it('par défaut : simulé en développement, désactivé en production', () => {
    expect(createEmailProvider({ ...base, NODE_ENV: 'development' })).toBeInstanceOf(
      ConsoleEmailProvider,
    );
    const production = createEmailProvider({ ...base, NODE_ENV: 'production' });
    expect(production).toBeInstanceOf(DisabledEmailProvider);
    expect(production.enabled).toBe(false);
  });

  it('échappe chaque valeur du gabarit JSON (guillemets, retours à la ligne)', () => {
    const body = fillEmailTemplate(
      '{"to":"{{to}}","subject":"{{ subject }}","text":"{{text}}","from":"{{from}}"}',
      { to: 'a@b.fr', from: 'X <x@y.ma>', subject: 'Code "123"', text: 'ligne 1\nligne 2' },
    );
    expect(JSON.parse(body)).toEqual({
      to: 'a@b.fr',
      subject: 'Code "123"',
      text: 'ligne 1\nligne 2',
      from: 'X <x@y.ma>',
    });
  });

  it('http : POST JSON avec l’en-tête d’authentification ; un statut d’erreur échoue sans détail', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const provider = new HttpEmailProvider(
      {
        url: 'https://api.exemple.com/send',
        body: '{"to":"{{to}}","subject":"{{subject}}","text":"{{text}}"}',
        from: 'codes@exemple.ma',
        authHeaderName: 'api-key',
        authHeaderValue: 'secret',
        timeoutMs: 1_000,
      },
      (url, init) => {
        calls.push({ url, init });
        return Promise.resolve(new Response('{}', { status: calls.length === 1 ? 201 : 401 }));
      },
    );
    await provider.send({ to: 'mre@exemple.fr', subject: 'Code 123456', text: 'Code 123456' });
    expect((calls[0]?.init.headers as Record<string, string>)['api-key']).toBe('secret');
    await expect(
      provider.send({ to: 'mre@exemple.fr', subject: 'Code 654321', text: 'Code 654321' }),
    ).rejects.toThrow(/statut 401/);
    await expect(
      provider.send({ to: 'mre@exemple.fr', subject: 'Code 654321', text: 'Code 654321' }),
    ).rejects.not.toThrow(/654321|mre@/);
  });

  it('masque l’adresse dans les journaux', () => {
    expect(maskEmail('salma.bennani@exemple.ma')).toBe('s***@exemple.ma');
  });
});
