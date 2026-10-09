import { describe, expect, it } from 'vitest';

import { ORDER_STATUSES, type OrderStatus } from '../enums';
import {
  availableTransitions,
  checkOrderEdit,
  checkTransition,
  findTransition,
  ORDER_TRANSITIONS,
  orderEditPolicy,
  TERMINAL_ORDER_STATUSES,
} from './order-status';

const ADMIN = new Set([
  'orders.write',
  'orders.cancel',
  'orders.edit_confirmed',
  'deliveries.update_status',
]);
const EMPLOYEE = new Set(['orders.write']);
const DRIVER = new Set(['deliveries.update_status']);

/** Transitions attendues, écrites à la main : toute évolution de la machine doit être voulue. */
const EXPECTED: Record<OrderStatus, OrderStatus[]> = {
  DRAFT: ['PENDING', 'CONFIRMED', 'CANCELLED'],
  PENDING: ['CONFIRMED', 'QUOTED', 'CANCELLED'],
  QUOTED: ['CONFIRMED', 'PENDING', 'CANCELLED'],
  CONFIRMED: ['PENDING', 'IN_PREPARATION', 'CANCELLED'],
  IN_PREPARATION: ['OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED'],
  OUT_FOR_DELIVERY: ['DELIVERED'],
  DELIVERED: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
};

describe('machine à états des commandes', () => {
  it('autorise exactement les transitions prévues, et aucune autre', () => {
    for (const from of ORDER_STATUSES) {
      for (const to of ORDER_STATUSES) {
        expect(Boolean(findTransition(from, to)), `${from} → ${to}`).toBe(
          EXPECTED[from].includes(to),
        );
      }
    }
  });

  it('les statuts finaux n’ont aucune sortie (pas de réouverture)', () => {
    for (const status of TERMINAL_ORDER_STATUSES) {
      expect(ORDER_TRANSITIONS.filter((item) => item.from === status)).toEqual([]);
    }
  });

  it('exige un motif pour annuler et pour déconfirmer', () => {
    expect(checkTransition('PENDING', 'CANCELLED', ADMIN)).toEqual({
      ok: false,
      denial: 'REASON_REQUIRED',
    });
    expect(checkTransition('PENDING', 'CANCELLED', ADMIN, '   ')).toMatchObject({ ok: false });
    expect(checkTransition('PENDING', 'CANCELLED', ADMIN, 'Mariage reporté')).toMatchObject({
      ok: true,
    });
    expect(checkTransition('CONFIRMED', 'PENDING', ADMIN)).toMatchObject({
      denial: 'REASON_REQUIRED',
    });
  });

  it('applique les permissions : l’employé confirme mais n’annule pas', () => {
    expect(checkTransition('PENDING', 'CONFIRMED', EMPLOYEE)).toMatchObject({ ok: true });
    expect(checkTransition('PENDING', 'CANCELLED', EMPLOYEE, 'motif')).toEqual({
      ok: false,
      denial: 'MISSING_PERMISSION',
    });
  });

  it('le livreur ne fait avancer que la livraison', () => {
    expect(checkTransition('IN_PREPARATION', 'OUT_FOR_DELIVERY', DRIVER)).toMatchObject({
      ok: true,
    });
    expect(checkTransition('OUT_FOR_DELIVERY', 'DELIVERED', DRIVER)).toMatchObject({ ok: true });
    expect(checkTransition('PENDING', 'CONFIRMED', DRIVER)).toMatchObject({
      denial: 'MISSING_PERMISSION',
    });
  });

  it('refuse un saut de statut et les transitions automatiques (devis)', () => {
    expect(checkTransition('PENDING', 'DELIVERED', ADMIN)).toEqual({
      ok: false,
      denial: 'INVALID_TRANSITION',
    });
    expect(checkTransition('PENDING', 'QUOTED', ADMIN)).toEqual({
      ok: false,
      denial: 'AUTOMATIC_TRANSITION',
    });
    expect(checkTransition('COMPLETED', 'CANCELLED', ADMIN, 'motif')).toMatchObject({
      denial: 'INVALID_TRANSITION',
    });
  });

  it('seules les confirmations vérifient la disponibilité', () => {
    const checked = ORDER_TRANSITIONS.filter((item) => item.checksAvailability).map(
      (item) => `${item.from}→${item.to}`,
    );
    expect(checked).toEqual(['DRAFT→CONFIRMED', 'PENDING→CONFIRMED', 'QUOTED→CONFIRMED']);
  });

  it('propose les actions selon le statut et les droits', () => {
    const targets = (status: OrderStatus, permissions: Set<string>) =>
      availableTransitions(status, permissions).map((item) => item.to);
    expect(targets('PENDING', ADMIN)).toEqual(['CONFIRMED', 'CANCELLED']);
    expect(targets('PENDING', EMPLOYEE)).toEqual(['CONFIRMED']);
    expect(targets('IN_PREPARATION', DRIVER)).toEqual(['OUT_FOR_DELIVERY', 'DELIVERED']);
    expect(targets('COMPLETED', ADMIN)).toEqual([]);
  });
});

describe('modification d’une commande selon son statut', () => {
  it('tout est libre avant confirmation', () => {
    const all = new Set(['free', 'framed', 'date', 'client', 'internalNotes'] as const);
    expect(checkOrderEdit('PENDING', all, EMPLOYEE)).toBeNull();
    expect(checkOrderEdit('DRAFT', all, EMPLOYEE)).toBeNull();
  });

  it('confirmée : notes libres, le reste avec motif et permission, client verrouillé', () => {
    expect(checkOrderEdit('CONFIRMED', new Set(['free']), EMPLOYEE)).toBeNull();
    expect(checkOrderEdit('CONFIRMED', new Set(['framed']), EMPLOYEE)).toEqual({
      denial: 'MISSING_PERMISSION',
      group: 'framed',
    });
    expect(checkOrderEdit('CONFIRMED', new Set(['framed']), ADMIN)).toEqual({
      denial: 'REASON_REQUIRED',
      group: 'framed',
    });
    expect(checkOrderEdit('CONFIRMED', new Set(['date']), ADMIN, '+30 invités')).toBeNull();
    expect(checkOrderEdit('CONFIRMED', new Set(['client']), ADMIN, 'motif')).toMatchObject({
      denial: 'ORDER_LOCKED',
    });
  });

  it('en préparation : la date est verrouillée', () => {
    expect(orderEditPolicy('IN_PREPARATION').date).toBe('locked');
    expect(checkOrderEdit('IN_PREPARATION', new Set(['framed']), ADMIN, 'motif')).toBeNull();
    expect(checkOrderEdit('IN_PREPARATION', new Set(['date']), ADMIN, 'motif')).toMatchObject({
      denial: 'ORDER_LOCKED',
    });
  });

  it('livrée, clôturée ou annulée : seules les notes internes', () => {
    for (const status of ['OUT_FOR_DELIVERY', 'DELIVERED', 'COMPLETED', 'CANCELLED'] as const) {
      expect(checkOrderEdit(status, new Set(['internalNotes']), ADMIN)).toBeNull();
      expect(checkOrderEdit(status, new Set(['free']), ADMIN, 'motif')).toMatchObject({
        denial: 'ORDER_LOCKED',
      });
    }
  });
});
