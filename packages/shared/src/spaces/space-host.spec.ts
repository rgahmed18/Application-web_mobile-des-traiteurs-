import { describe, expect, it } from 'vitest';

import { classifyHost, normalizeHostname } from './space-host';

const production = {
  baseDomain: 'gestion-traiteurs.ma',
  platformHostnames: ['console.gestion-traiteurs.ma'],
};

describe('normalizeHostname', () => {
  it('retire le port, le point final et met en minuscules', () => {
    expect(normalizeHostname('Dar-Diafa.Gestion-Traiteurs.ma:443')).toBe(
      'dar-diafa.gestion-traiteurs.ma',
    );
    expect(normalizeHostname('exemple.ma.')).toBe('exemple.ma');
    expect(normalizeHostname('localhost:3001')).toBe('localhost');
  });

  it('refuse les adresses invalides', () => {
    expect(normalizeHostname('')).toBeNull();
    expect(normalizeHostname(null)).toBeNull();
    expect(normalizeHostname('[::1]:3001')).toBeNull();
    expect(normalizeHostname('evil.ma/../x')).toBeNull();
    expect(normalizeHostname('-tiret.ma')).toBeNull();
    expect(normalizeHostname('a b.ma')).toBeNull();
  });
});

describe('classifyHost', () => {
  it('console, sous-domaine d’un traiteur, domaine personnalisé', () => {
    expect(classifyHost('console.gestion-traiteurs.ma', production)).toEqual({ kind: 'platform' });
    expect(classifyHost('dar-diafa.gestion-traiteurs.ma', production)).toEqual({
      kind: 'subdomain',
      slug: 'dar-diafa',
    });
    expect(classifyHost('traiteur-dar-diafa.ma', production)).toEqual({
      kind: 'custom',
      hostname: 'traiteur-dar-diafa.ma',
    });
  });

  it('jamais un traiteur : sous-domaines réservés, deux niveaux, domaine nu, IP', () => {
    for (const host of [
      'www.gestion-traiteurs.ma',
      'api.gestion-traiteurs.ma',
      'a.b.gestion-traiteurs.ma',
      'gestion-traiteurs.ma',
      '192.168.1.8',
      'localhost',
    ]) {
      expect(classifyHost(host, production)).toBeNull();
    }
  });

  it('démonstration (nip.io) et développement (*.localhost)', () => {
    const demo = {
      baseDomain: '192.168.1.8.nip.io',
      platformHostnames: ['192.168.1.8.nip.io', '192.168.1.8', 'localhost'],
    };
    expect(classifyHost('dar-diafa.192.168.1.8.nip.io:3001', demo)).toEqual({
      kind: 'subdomain',
      slug: 'dar-diafa',
    });
    expect(classifyHost('192.168.1.8:3001', demo)).toEqual({ kind: 'platform' });
    expect(classifyHost('localhost:3001', demo)).toEqual({ kind: 'platform' });

    const dev = { baseDomain: 'localhost', platformHostnames: ['localhost'] };
    expect(classifyHost('zakaria-rguibi.localhost:3001', dev)).toEqual({
      kind: 'subdomain',
      slug: 'zakaria-rguibi',
    });
  });
});
