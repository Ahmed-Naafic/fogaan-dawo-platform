import { prisma } from '../../config/database.js';
import { dayKey, describeRange, inRange, monthKey } from '../finance/finance.dates.js';
import { csvCell } from '../finance/finance.service.js';
import { resolveAdminRange } from './adminRange.js';

/**
 * Admin › Reports: platform activity (not money — that is Admin › Finance › Reports). Every figure is
 * counted from stored rows for the range in the administrator's zone:
 *  - sign-ups by account creation; doctors by verification date;
 *  - appointments by their START time (what happened in the period), bookings by creation time;
 *  - completion / no-show rates over consultations that reached their end (COMPLETED + NO_SHOW).
 */

/** Statuses of an appointment that was paid for (it took place, is booked, or the patient missed it). */
const PAID_STATUSES = Object.freeze(['CONFIRMED', 'WAITING', 'IN_PROGRESS', 'COMPLETED', 'NO_SHOW']);
const DAILY_LIMIT_DAYS = 92;
const TOP = 5;

const rate = (part, whole) => (whole > 0 ? Number((part / whole).toFixed(4)) : null);

export async function overview(query = {}, client = prisma) {
  const range = resolveAdminRange(query, '30d');
  const when = (field) => (range.from ? { [field]: inRange(range) } : {});
  const [newPatients, newDoctors, totalPatients, activeDoctors, appointments, booked] = await Promise.all([
    client.patientProfile.count({ where: { user: when('createdAt') } }),
    client.doctorProfile.count({ where: { verificationStatus: 'VERIFIED', verifiedAt: range.from ? inRange(range) : { not: null } } }),
    client.patientProfile.count(),
    client.doctorProfile.count({ where: { verificationStatus: 'VERIFIED', accountStatus: 'ACTIVE' } }),
    client.appointment.findMany({
      where: when('startAtUtc'),
      select: { status: true, startAtUtc: true, doctorId: true, doctor: { select: { user: { select: { fullName: true } }, specialty: { select: { id: true, nameEn: true, nameSo: true } } } } },
    }),
    client.appointment.count({ where: when('createdAt') }),
  ]);

  const byStatus = {};
  for (const a of appointments) byStatus[a.status] = (byStatus[a.status] ?? 0) + 1;
  const completed = byStatus.COMPLETED ?? 0;
  const noShow = byStatus.NO_SHOW ?? 0;
  const cancelled = byStatus.CANCELLED ?? 0;
  const paid = appointments.filter((a) => PAID_STATUSES.includes(a.status));

  // Trend: daily for short ranges, monthly for long or open ("all") ranges.
  const days = range.from ? Math.round((range.to - range.from) / 86_400_000) : Infinity;
  const granularity = days <= DAILY_LIMIT_DAYS ? 'day' : 'month';
  const bucket = (d) => (granularity === 'day' ? dayKey(d, range.tz) : monthKey(d, range.tz));
  const trend = new Map();
  for (const a of appointments) {
    const row = trend.get(bucket(a.startAtUtc)) ?? { appointments: 0, completed: 0, cancelled: 0 };
    row.appointments += 1;
    if (a.status === 'COMPLETED') row.completed += 1;
    if (a.status === 'CANCELLED') row.cancelled += 1;
    trend.set(bucket(a.startAtUtc), row);
  }
  if (granularity === 'day' && range.fromDate) {
    for (let d = new Date(`${range.fromDate}T00:00:00Z`); d.toISOString().slice(0, 10) <= range.toDate; d = new Date(d.getTime() + 86_400_000)) {
      const key = d.toISOString().slice(0, 10);
      if (!trend.has(key)) trend.set(key, { appointments: 0, completed: 0, cancelled: 0 });
    }
  }

  const top = (items, keyOf, present) => {
    const counts = new Map();
    for (const a of items) {
      const k = keyOf(a);
      counts.set(k, { item: a, n: (counts.get(k)?.n ?? 0) + 1 });
    }
    return [...counts.values()].sort((x, y) => y.n - x.n).slice(0, TOP).map(({ item, n }) => ({ ...present(item), count: n }));
  };

  return {
    range: describeRange(range),
    users: { newPatients, newDoctors, totalPatients, activeDoctors },
    appointments: {
      total: appointments.length,
      booked,
      byStatus,
      paid: paid.length,
      completed,
      noShow,
      cancelled,
      completionRate: rate(completed, completed + noShow),
      noShowRate: rate(noShow, completed + noShow),
      cancellationRate: rate(cancelled, appointments.length),
    },
    topSpecialties: top(paid, (a) => a.doctor.specialty?.id ?? 'none', (a) => ({ id: a.doctor.specialty?.id ?? null, nameEn: a.doctor.specialty?.nameEn ?? null, nameSo: a.doctor.specialty?.nameSo ?? null })),
    topDoctors: top(appointments.filter((a) => a.status === 'COMPLETED'), (a) => a.doctorId, (a) => ({ id: a.doctorId, name: a.doctor.user.fullName })),
    granularity,
    trend: [...trend.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([period, v]) => ({ period, ...v })),
  };
}

/** GET /api/v1/admin/reports/export — the same figures as CSV (summary block, then the trend). */
export async function exportCsv(query = {}, client = prisma) {
  const r = await overview(query, client);
  const stamp = r.range.fromDate ? `${r.range.fromDate}_${r.range.toDate}` : 'all-time';
  const pct = (v) => (v == null ? '' : `${(v * 100).toFixed(1)}%`);
  const rows = [
    ['metric', 'value'],
    ['new_patients', r.users.newPatients],
    ['newly_verified_doctors', r.users.newDoctors],
    ['total_patients', r.users.totalPatients],
    ['active_doctors', r.users.activeDoctors],
    ['appointments_in_period', r.appointments.total],
    ['bookings_made', r.appointments.booked],
    ['paid_appointments', r.appointments.paid],
    ['completed', r.appointments.completed],
    ['no_shows', r.appointments.noShow],
    ['cancelled', r.appointments.cancelled],
    ['completion_rate', pct(r.appointments.completionRate)],
    ['no_show_rate', pct(r.appointments.noShowRate)],
    ['cancellation_rate', pct(r.appointments.cancellationRate)],
    [],
    ['period', 'appointments', 'completed', 'cancelled'],
    ...r.trend.map((t) => [t.period, t.appointments, t.completed, t.cancelled]),
  ];
  return { filename: `fogaan-dawo-activity_${stamp}.csv`, body: `﻿${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n` };
}
