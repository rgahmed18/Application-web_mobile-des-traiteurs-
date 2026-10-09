import { divideAndRound } from '../money/money';
import { addDays } from '../time/zoned';

/**
 * Échéancier d'une commande : acompte puis solde.
 *
 * - Acompte : total TTC × pourcentage du traiteur, arrondi au dirham le plus proche ; figé à la
 *   confirmation (Order.depositAmount, modifiable par le traiteur), dû dès la confirmation.
 * - Solde : total TTC − acompte, dû N jours avant l'événement (J-7 par défaut).
 * - Si le solde tomberait au plus tard le jour de la confirmation (événement proche), une seule
 *   échéance : la totalité, due à la confirmation.
 * - Les paiements couvrent les échéances dans l'ordre (acompte, puis solde).
 * - En retard : échéance d'une commande confirmée, dont la date est passée et non couverte.
 * Dates : jours civils « AAAA-MM-JJ » du traiteur.
 */

export type InstallmentKind = 'DEPOSIT' | 'BALANCE' | 'FULL';

export interface Installment {
  kind: InstallmentKind;
  amount: number;
  /** null : due à la confirmation, pas encore intervenue. */
  dueDate: string | null;
  paid: number;
  remaining: number;
  overdue: boolean;
}

export interface PaymentSchedule {
  installments: Installment[];
  totalTtc: number;
  /** Payé net (encaissements − remboursements). */
  paid: number;
  remaining: number;
  overdueAmount: number;
  /** Plus ancienne échéance en retard. */
  overdueSince: string | null;
}

export interface ScheduleInput {
  totalTtc: number;
  /** Acompte figé (0 = pas encore figé : acompte prévu selon le pourcentage). */
  depositAmount: number;
  depositPercentBps: number;
  balanceDueDays: number;
  /** Jour de confirmation (null : commande pas encore confirmée). */
  confirmedOn: string | null;
  eventDate: string;
  paid: number;
  today: string;
  cancelled: boolean;
}

/** Acompte prévu : pourcentage du total TTC, arrondi au dirham le plus proche. */
export function plannedDeposit(totalTtc: number, depositPercentBps: number): number {
  if (totalTtc <= 0 || depositPercentBps <= 0) return 0;
  const exact = divideAndRound(totalTtc * depositPercentBps, 10_000);
  return Math.min(totalTtc, divideAndRound(exact, 100) * 100);
}

export function computePaymentSchedule(input: ScheduleInput): PaymentSchedule {
  const { totalTtc, paid, today, confirmedOn } = input;
  if (input.cancelled) {
    return { installments: [], totalTtc, paid, remaining: 0, overdueAmount: 0, overdueSince: null };
  }

  const deposit = Math.min(
    totalTtc,
    input.depositAmount > 0
      ? input.depositAmount
      : plannedDeposit(totalTtc, input.depositPercentBps),
  );
  const balanceDue = addDays(input.eventDate, -input.balanceDueDays);
  const single = deposit >= totalTtc || (confirmedOn !== null && balanceDue <= confirmedOn);

  const plan: Omit<Installment, 'paid' | 'remaining' | 'overdue'>[] = single
    ? [{ kind: 'FULL', amount: totalTtc, dueDate: confirmedOn }]
    : [
        ...(deposit > 0
          ? [{ kind: 'DEPOSIT' as const, amount: deposit, dueDate: confirmedOn }]
          : []),
        { kind: 'BALANCE', amount: totalTtc - deposit, dueDate: balanceDue },
      ];

  let available = Math.max(0, paid);
  let overdueAmount = 0;
  let overdueSince: string | null = null;
  const installments = plan.map((item) => {
    const covered = Math.min(item.amount, available);
    available -= covered;
    const remaining = item.amount - covered;
    const overdue =
      confirmedOn !== null && item.dueDate !== null && item.dueDate < today && remaining > 0;
    if (overdue) {
      overdueAmount += remaining;
      if (overdueSince === null || (item.dueDate !== null && item.dueDate < overdueSince)) {
        overdueSince = item.dueDate;
      }
    }
    return { ...item, paid: covered, remaining, overdue };
  });

  return {
    installments,
    totalTtc,
    paid,
    remaining: Math.max(0, totalTtc - paid),
    overdueAmount,
    overdueSince,
  };
}
