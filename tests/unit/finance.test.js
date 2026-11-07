// Unit tests: commission split, commission validation, refund allocation from the saved snapshot,
// doctor earnings, rounding, date ranges and CSV safety. No database, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allocateRefunds, commissionFractionFromPercent, earningsTotals, percentFromFraction, splitPayment } from '../../apps/api/src/modules/finance/finance.calc.js';
import { resolveRange } from '../../apps/api/src/modules/finance/finance.dates.js';
import { csvCell } from '../../apps/api/src/modules/finance/finance.service.js';

const s = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'object' && v !== null && 'toFixed' in v ? v.toFixed(2) : v]));

test('commission split: round half-up on the commission, the doctor gets the remainder (sums exactly)', () => {
  assert.deepEqual(s(splitPayment('20.00', '0.1500')), { gross: '20.00', commission: '3.00', net: '17.00' });
  assert.deepEqual(s(splitPayment('25.00', '0.1500')), { gross: '25.00', commission: '3.75', net: '21.25' });
  assert.deepEqual(s(splitPayment('19.99', '0.1500')), { gross: '19.99', commission: '3.00', net: '16.99' }, '2.9985 → 3.00');
  assert.deepEqual(s(splitPayment('33.33', '0.1250')), { gross: '33.33', commission: '4.17', net: '29.16' }, '4.16625 → 4.17');
  assert.deepEqual(s(splitPayment('10.00', '0')), { gross: '10.00', commission: '0.00', net: '10.00' });
  assert.deepEqual(s(splitPayment('10.00', '1')), { gross: '10.00', commission: '10.00', net: '0.00' });
  for (const [g, r] of [['5.01', '0.3333'], ['199.99', '0.0750'], ['7.77', '0.1500']]) {
    const x = splitPayment(g, r);
    assert.equal(x.commission.plus(x.net).toFixed(2), x.gross.toFixed(2), `${g} × ${r}`);
  }
});

test('commission validation: percent 0–100 with at most 2 decimals, stored as a 4-decimal fraction', () => {
  assert.equal(commissionFractionFromPercent('15'), '0.1500');
  assert.equal(commissionFractionFromPercent(12.5), '0.1250');
  assert.equal(commissionFractionFromPercent('0'), '0.0000');
  assert.equal(commissionFractionFromPercent('100'), '1.0000');
  assert.equal(commissionFractionFromPercent('7.25'), '0.0725');
  for (const bad of ['-1', '100.01', '101', '15.123', 'abc', '', ' ', '1e2', '0x10', null, undefined, {}, '15%']) {
    assert.throws(() => commissionFractionFromPercent(bad), (e) => ['COMMISSION_INVALID', 'COMMISSION_OUT_OF_RANGE'].includes(e.code), String(bad));
  }
  assert.equal(percentFromFraction('0.1500'), '15.00');
});

test('refund allocation reverses the SAVED split; partial refunds add up exactly to a full reversal', () => {
  // Payment 20.00 at the saved 15 % → commission 3.00, doctor 17.00.
  const full = allocateRefunds({ gross: '20.00', commission: '3.00' }, ['20.00']).map(s);
  assert.deepEqual(full, [{ amount: '20.00', commission: '3.00', doctor: '17.00' }]);
  const half = allocateRefunds({ gross: '20.00', commission: '3.00' }, ['10.00']).map(s);
  assert.deepEqual(half, [{ amount: '10.00', commission: '1.50', doctor: '8.50' }], '50 % policy refund');
  // Awkward numbers: three partial refunds of 33.33 + 33.33 + 33.34 on 100.00 at 12.5 % (commission 12.50).
  const parts = allocateRefunds({ gross: '100.00', commission: '12.50' }, ['33.33', '33.33', '33.34']).map(s);
  assert.deepEqual(parts.map((p) => p.commission), ['4.17', '4.16', '4.17']);
  const total = parts.reduce((a, p) => a + Math.round(Number(p.commission) * 100), 0);
  assert.equal(total, 1250, 'commission reversals sum exactly to the original commission');
  for (const p of parts) assert.equal((Number(p.commission) * 100 + Number(p.doctor) * 100).toFixed(0), (Number(p.amount) * 100).toFixed(0));
  // Historical protection: a later change of the setting is irrelevant — only the saved commission is used.
  assert.deepEqual(allocateRefunds({ gross: '20.00', commission: '3.00' }, ['20.00']), allocateRefunds({ gross: '20.00', commission: '3.00' }, ['20.00']));
  assert.deepEqual(allocateRefunds({ gross: '0', commission: '0' }, ['0']).map(s), [{ amount: '0.00', commission: '0.00', doctor: '0.00' }]);
});

test('doctor earnings: gross, refund deductions, commission and net from snapshots', () => {
  const t = earningsTotals([
    { gross: '20.00', commission: '3.00', net: '17.00', refunds: [] },
    { gross: '20.00', commission: '3.00', net: '17.00', refunds: ['10.00'] }, // 50 % refund
    { gross: '25.00', commission: '2.50', net: '22.50', refunds: ['25.00'] }, // saved at 10 %, fully refunded
  ]);
  assert.deepEqual(t, {
    count: 3,
    gross: '65.00',
    refunds: '35.00',
    commission: '4.50', // 8.50 − (1.50 + 2.50)
    commissionBeforeRefunds: '8.50',
    doctorNet: '25.50', // 56.50 − (8.50 + 22.50)
    doctorBeforeRefunds: '56.50',
    doctorRefundDeductions: '31.00',
  });
});

test('date ranges: half-open [from, to) on calendar days in the admin time zone', () => {
  const now = new Date('2026-11-10T21:30:00Z'); // 00:30 on 11 Nov in Mogadishu (UTC+3)
  const today = resolveRange({ preset: 'today', tz: 'Africa/Mogadishu' }, now);
  assert.equal(today.fromDate, '2026-11-11');
  assert.equal(today.from.toISOString(), '2026-11-10T21:00:00.000Z');
  assert.equal(today.to.toISOString(), '2026-11-11T21:00:00.000Z');
  const week = resolveRange({ preset: '7d', tz: 'UTC' }, now);
  assert.deepEqual([week.fromDate, week.toDate], ['2026-11-04', '2026-11-10']);
  assert.equal(week.to.toISOString(), '2026-11-11T00:00:00.000Z');
  assert.equal(resolveRange({ preset: '30d', tz: 'UTC' }, now).fromDate, '2026-10-12');
  assert.equal(resolveRange({ preset: 'month', tz: 'UTC' }, now).fromDate, '2026-11-01');
  const custom = resolveRange({ preset: 'custom', fromDate: '2026-10-01', toDate: '2026-10-31', tz: 'Africa/Mogadishu' }, now);
  assert.equal(custom.from.toISOString(), '2026-09-30T21:00:00.000Z');
  assert.equal(custom.to.toISOString(), '2026-10-31T21:00:00.000Z', 'end date is inclusive');
  assert.deepEqual(resolveRange({ preset: 'all' }, now), { preset: 'all', tz: 'Africa/Mogadishu', from: null, to: null, fromDate: null, toDate: null });
  assert.equal(resolveRange({ preset: 'today', tz: 'Not/AZone' }, now).tz, 'Africa/Mogadishu', 'invalid zone falls back');
  for (const bad of [{ preset: 'custom' }, { preset: 'custom', fromDate: '2026-10-31', toDate: '2026-10-01' }, { preset: 'custom', fromDate: '2024-01-01', toDate: '2026-01-01' }, { preset: 'custom', fromDate: '2026-02-30x', toDate: '2026-03-01' }, { preset: 'year' }]) {
    assert.throws(() => resolveRange(bad, now), (e) => ['RANGE_INVALID', 'RANGE_TOO_LONG'].includes(e.code), JSON.stringify(bad));
  }
});

test('CSV cells are quoted and spreadsheet formulas are neutralised', () => {
  assert.equal(csvCell('Dr. "Hodan"'), '"Dr. ""Hodan"""');
  assert.equal(csvCell('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`);
  for (const f of ['+1', '-2', '@SUM(A1)']) assert.ok(csvCell(f).startsWith(`"'`), f);
  assert.equal(csvCell(null), '""');
  assert.equal(csvCell('20.00'), '"20.00"');
});
