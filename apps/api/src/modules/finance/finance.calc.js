import { Decimal, roundMoney, sumMoney, toDecimal } from '../../utils/money.js';

/**
 * Finance arithmetic as pure functions (unit-tested). Exact decimals only; currency rounding is
 * half-up to 2 places. These functions never read the CURRENT commission setting: every split is
 * computed from the snapshot saved when the payment succeeded.
 */

/** Gross → { commission, net } with commission = round(gross × rate); net takes the rounding remainder. */
export function splitPayment(gross, rate) {
  const g = roundMoney(gross);
  const commission = roundMoney(g.times(toDecimal(rate)));
  return { gross: g, commission, net: g.minus(commission) };
}

/**
 * How successful refunds reverse a payment's original split, in the order they were paid out.
 * Shares are computed CUMULATIVELY from the saved snapshot (commission / gross), so the rounding of
 * several partial refunds always adds up exactly, and a full refund reverses exactly the original
 * commission and doctor earning.
 *   allocateRefunds({ gross, commission }, [r1, r2…]) → [{ amount, commission, doctor }…]
 */
export function allocateRefunds({ gross, commission }, refundAmounts) {
  const g = toDecimal(gross);
  const c = toDecimal(commission);
  const commissionShareOf = (cumulative) => (g.isZero() ? new Decimal(0) : roundMoney(cumulative.times(c).dividedBy(g)));
  let cumulative = new Decimal(0);
  let reversedCommission = new Decimal(0);
  return refundAmounts.map((raw) => {
    const amount = roundMoney(raw);
    cumulative = cumulative.plus(amount);
    const commissionTarget = commissionShareOf(Decimal.min(cumulative, g));
    const commissionPart = commissionTarget.minus(reversedCommission);
    reversedCommission = commissionTarget;
    return { amount, commission: commissionPart, doctor: amount.minus(commissionPart) };
  });
}

/**
 * Validates an administrator's commission input given as a PERCENT (0–100, max 2 decimals) and returns
 * the stored fraction as a 4-decimal string ("15" → "0.1500"). Throws a RangeError with a code.
 */
export function commissionFractionFromPercent(input) {
  const text = typeof input === 'number' ? String(input) : typeof input === 'string' ? input.trim() : '';
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(text)) throw Object.assign(new RangeError('Commission must be a number with at most 2 decimals'), { code: 'COMMISSION_INVALID' });
  const percent = new Decimal(text);
  if (percent.isNegative() || percent.greaterThan(100)) throw Object.assign(new RangeError('Commission must be between 0% and 100%'), { code: 'COMMISSION_OUT_OF_RANGE' });
  return percent.dividedBy(100).toFixed(4);
}

/** "0.1500" → "15.00" (percent string for display). */
export const percentFromFraction = (fraction) => toDecimal(fraction).times(100).toFixed(2);

/**
 * One doctor-earnings line from earning snapshots and their successful refunds:
 * gross, refunds, commission (net of reversals) and the doctor's net earnings — all from snapshots.
 *   items: [{ gross, commission, net, refunds: [amount…] (chronological) }]
 */
export function earningsTotals(items) {
  const totals = { count: 0, gross: new Decimal(0), refunds: new Decimal(0), commission: new Decimal(0), commissionReversed: new Decimal(0), doctorGross: new Decimal(0), doctorReversed: new Decimal(0) };
  for (const it of items) {
    const allocation = allocateRefunds({ gross: it.gross, commission: it.commission }, it.refunds ?? []);
    totals.count += 1;
    totals.gross = totals.gross.plus(toDecimal(it.gross));
    totals.commission = totals.commission.plus(toDecimal(it.commission));
    totals.doctorGross = totals.doctorGross.plus(toDecimal(it.net));
    totals.refunds = totals.refunds.plus(sumMoney(allocation.map((a) => a.amount)));
    totals.commissionReversed = totals.commissionReversed.plus(sumMoney(allocation.map((a) => a.commission)));
    totals.doctorReversed = totals.doctorReversed.plus(sumMoney(allocation.map((a) => a.doctor)));
  }
  return {
    count: totals.count,
    gross: totals.gross.toFixed(2),
    refunds: totals.refunds.toFixed(2),
    commission: totals.commission.minus(totals.commissionReversed).toFixed(2),
    commissionBeforeRefunds: totals.commission.toFixed(2),
    doctorNet: totals.doctorGross.minus(totals.doctorReversed).toFixed(2),
    doctorBeforeRefunds: totals.doctorGross.toFixed(2),
    doctorRefundDeductions: totals.doctorReversed.toFixed(2),
  };
}

/** Money as a fixed 2-decimal string. */
export const money = (value) => (value == null ? '0.00' : toDecimal(value).toFixed(2));
