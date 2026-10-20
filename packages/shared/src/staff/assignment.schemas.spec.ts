import { describe, expect, it } from 'vitest';

import { assignmentBatchSchema, MAX_ASSIGNMENT_BATCH } from './assignment.schemas';

const MEMBER_A = '0b8a2c8e-4f6d-4a39-9c39-6a1f0f0e0a01';
const MEMBER_B = '0b8a2c8e-4f6d-4a39-9c39-6a1f0f0e0a02';

const line = (overrides: Record<string, unknown> = {}) => ({
  membershipId: MEMBER_A,
  staffRole: 'WAITER',
  startsAt: '2026-10-24T19:00',
  endsAt: '2026-10-25T02:00',
  ...overrides,
});

describe('assignmentBatchSchema', () => {
  it('accepte plusieurs membres, et un même membre avec deux rôles différents', () => {
    const result = assignmentBatchSchema.safeParse({
      lines: [line(), line({ membershipId: MEMBER_B }), line({ staffRole: 'SUPERVISOR' })],
    });
    expect(result.success).toBe(true);
    // Valeurs par défaut de chaque ligne
    expect(result.data?.lines[0]).toMatchObject({ force: false, notes: null, cashToCollect: null });
  });

  it('refuse un même membre deux fois avec le même rôle, sur la ligne en double', () => {
    const result = assignmentBatchSchema.safeParse({ lines: [line(), line()] });
    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual([
      expect.objectContaining({ path: ['lines', 1, 'staffRole'] }),
    ]);
  });

  it('valide chaque ligne : fin après le début', () => {
    const result = assignmentBatchSchema.safeParse({
      lines: [line(), line({ membershipId: MEMBER_B, endsAt: '2026-10-24T18:00' })],
    });
    expect(result.error?.issues[0]?.path).toEqual(['lines', 1, 'endsAt']);
  });

  it('exige au moins une ligne et en limite le nombre', () => {
    expect(assignmentBatchSchema.safeParse({ lines: [] }).success).toBe(false);
    const many = Array.from({ length: MAX_ASSIGNMENT_BATCH + 1 }, (_, index) =>
      line({ staffRole: index % 2 ? 'WAITER' : 'COOK', membershipId: MEMBER_A }),
    );
    expect(assignmentBatchSchema.safeParse({ lines: many }).success).toBe(false);
  });
});
