import { describe, expect, it } from 'vitest';

import { clientIpFromHeaders } from './client-ip';

const FORGED = '6.6.6.6';
const CLIENT = '41.250.10.20';
const CLOUDFLARE = '172.70.1.1';

const headers = (values: Record<string, string>) => new Headers(values);

describe('clientIpFromHeaders', () => {
  describe('sans proxy (0)', () => {
    it('ignore X-Forwarded-For et X-Real-IP envoyés par le navigateur', () => {
      expect(
        clientIpFromHeaders(headers({ 'x-forwarded-for': FORGED, 'x-real-ip': FORGED }), 0),
      ).toBeNull();
      expect(
        clientIpFromHeaders(headers({ 'x-forwarded-for': `${FORGED}, ${CLIENT}` }), 0),
      ).toBeNull();
    });
  });

  describe('un proxy (Nginx)', () => {
    it('retient l’adresse ajoutée par le proxy, jamais celle écrite par le client', () => {
      // Le client envoie « X-Forwarded-For: 6.6.6.6 », Nginx ajoute l'adresse réelle à droite
      expect(clientIpFromHeaders(headers({ 'x-forwarded-for': `${FORGED}, ${CLIENT}` }), 1)).toBe(
        CLIENT,
      );
      expect(
        clientIpFromHeaders(headers({ 'x-forwarded-for': `1.1.1.1, ${FORGED}, ${CLIENT}` }), 1),
      ).toBe(CLIENT);
    });

    it('sans en-tête forgé', () => {
      expect(clientIpFromHeaders(headers({ 'x-forwarded-for': CLIENT }), 1)).toBe(CLIENT);
    });

    it('ignore X-Real-IP', () => {
      expect(clientIpFromHeaders(headers({ 'x-real-ip': FORGED }), 1)).toBeNull();
    });
  });

  describe('deux proxys (Cloudflare puis Nginx)', () => {
    it('retient l’adresse ajoutée par Cloudflare, pas la valeur forgée', () => {
      // Cloudflare ajoute le client, Nginx ajoute l'adresse de Cloudflare
      expect(
        clientIpFromHeaders(
          headers({ 'x-forwarded-for': `${FORGED}, ${CLIENT}, ${CLOUDFLARE}` }),
          2,
        ),
      ).toBe(CLIENT);
    });

    it('refuse une liste trop courte (accès direct qui contourne un proxy)', () => {
      // Requête arrivée directement sur Nginx : une seule adresse, celle ajoutée par Nginx.
      // (L'origine doit n'accepter que les adresses de Cloudflare, voir le README.)
      expect(clientIpFromHeaders(headers({ 'x-forwarded-for': CLIENT }), 2)).toBeNull();
    });
  });

  it('refuse une valeur qui n’est pas une adresse IP', () => {
    expect(clientIpFromHeaders(headers({ 'x-forwarded-for': 'evil, <script>' }), 1)).toBeNull();
    expect(clientIpFromHeaders(headers({ 'x-forwarded-for': `${CLIENT}, ` }), 1)).toBeNull();
  });

  it('accepte IPv6', () => {
    expect(clientIpFromHeaders(headers({ 'x-forwarded-for': `${FORGED}, 2001:db8::1` }), 1)).toBe(
      '2001:db8::1',
    );
  });
});
