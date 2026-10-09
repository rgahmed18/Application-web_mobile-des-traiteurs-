import { describe, expect, it } from 'vitest';

import { computePaymentSchedule, plannedDeposit, type ScheduleInput } from './payment-schedule';

const base: ScheduleInput = {
  totalTtc: 2_270_000, // 22 700,00
  depositAmount: 0,
  depositPercentBps: 3000,
  balanceDueDays: 7,
  confirmedOn: '2026-10-09',
  eventDate: '2026-11-24',
  paid: 0,
  today: '2026-10-09',
  cancelled: false,
};

describe('plannedDeposit', () => {
  it('30 % arrondi au dirham le plus proche', () => {
    expect(plannedDeposit(2_270_000, 3000)).toBe(681_000); // 6 810,00
    expect(plannedDeposit(1_234_567, 3000)).toBe(370_400); // 3 703,70 → 3 704,00
    expect(plannedDeposit(1_234_517, 3000)).toBe(370_400); // 3 703,55 → 3 704,00
    expect(plannedDeposit(1_234_483, 3000)).toBe(370_300); // 3 703,45 → 3 703,00
    expect(plannedDeposit(0, 3000)).toBe(0);
    expect(plannedDeposit(50_000, 0)).toBe(0);
  });
});

describe('computePaymentSchedule', () => {
  it('acompte dû à la confirmation, solde à J-7', () => {
    const schedule = computePaymentSchedule(base);
    expect(schedule.installments).toEqual([
      {
        kind: 'DEPOSIT',
        amount: 681_000,
        dueDate: '2026-10-09',
        paid: 0,
        remaining: 681_000,
        overdue: false,
      },
      {
        kind: 'BALANCE',
        amount: 1_589_000,
        dueDate: '2026-11-17',
        paid: 0,
        remaining: 1_589_000,
        overdue: false,
      },
    ]);
    expect(schedule.remaining).toBe(2_270_000);
  });

  it('les paiements couvrent l’acompte puis le solde', () => {
    const schedule = computePaymentSchedule({ ...base, paid: 1_000_000 });
    expect(schedule.installments.map((item) => [item.paid, item.remaining])).toEqual([
      [681_000, 0],
      [319_000, 1_270_000],
    ]);
    expect(schedule.remaining).toBe(1_270_000);
  });

  it('acompte figé à la confirmation, même si le total change ensuite', () => {
    const schedule = computePaymentSchedule({
      ...base,
      depositAmount: 700_000,
      totalTtc: 2_500_000,
    });
    expect(schedule.installments.map((item) => item.amount)).toEqual([700_000, 1_800_000]);
  });

  it('en retard : acompte non payé le lendemain de la confirmation', () => {
    const schedule = computePaymentSchedule({ ...base, today: '2026-10-10', paid: 200_000 });
    expect(schedule.overdueAmount).toBe(481_000);
    expect(schedule.overdueSince).toBe('2026-10-09');
    expect(schedule.installments[1]?.overdue).toBe(false);
  });

  it('en retard : solde non payé après J-7', () => {
    const schedule = computePaymentSchedule({ ...base, today: '2026-11-18', paid: 681_000 });
    expect(schedule.overdueAmount).toBe(1_589_000);
    expect(schedule.overdueSince).toBe('2026-11-17');
  });

  it('le jour même de l’échéance n’est pas un retard', () => {
    expect(
      computePaymentSchedule({ ...base, today: '2026-11-17', paid: 681_000 }).overdueAmount,
    ).toBe(0);
  });

  it('événement proche : une seule échéance, la totalité à la confirmation', () => {
    const schedule = computePaymentSchedule({ ...base, eventDate: '2026-10-14' });
    expect(schedule.installments).toEqual([
      {
        kind: 'FULL',
        amount: 2_270_000,
        dueDate: '2026-10-09',
        paid: 0,
        remaining: 2_270_000,
        overdue: false,
      },
    ]);
  });

  it('commande non confirmée : acompte prévu, jamais en retard', () => {
    const schedule = computePaymentSchedule({ ...base, confirmedOn: null, today: '2026-12-01' });
    expect(schedule.installments[0]).toMatchObject({
      kind: 'DEPOSIT',
      amount: 681_000,
      dueDate: null,
    });
    expect(schedule.overdueAmount).toBe(0);
  });

  it('sans acompte (0 %) : seulement le solde', () => {
    const schedule = computePaymentSchedule({ ...base, depositPercentBps: 0 });
    expect(schedule.installments.map((item) => item.kind)).toEqual(['BALANCE']);
  });

  it('commande annulée : plus d’échéance', () => {
    const schedule = computePaymentSchedule({ ...base, cancelled: true, paid: 681_000 });
    expect(schedule).toMatchObject({
      installments: [],
      remaining: 0,
      overdueAmount: 0,
      paid: 681_000,
    });
  });

  it('payé intégralement : reste 0, aucun retard', () => {
    const schedule = computePaymentSchedule({ ...base, paid: 2_270_000, today: '2026-12-01' });
    expect(schedule).toMatchObject({ remaining: 0, overdueAmount: 0 });
  });
});
