import { prisma } from '../../config/database.js';
import { ApiError } from '../../utils/ApiError.js';
import { addDays, dateInZone, startOfDayUtc } from '../../utils/timezone.js';
import { listSlotsInRange } from '../availability/availability.repository.js';
import { groupSlotsByDay } from '../availability/availability.service.js';
import * as doctorRepository from './doctor.repository.js';

/**
 * Public doctor directory: verified + active doctors only (BOOKABLE_DOCTOR_WHERE in every query),
 * public fields only. Licence numbers, documents, verification records, email and phone are never selected.
 */

/** Upper bound on matches sorted in memory; beyond this, move rating/next-slot sorting into SQL. */
const MAX_MATCHES = 500;

const round1 = (n) => Math.round(n * 10) / 10;

function presentDoctor(d, ratings, next, { full = false } = {}) {
  const r = ratings.get(d.id);
  return {
    id: d.id,
    name: d.user.fullName,
    specialty: d.specialty,
    consultationFee: d.consultationFee.toFixed(2),
    currency: d.currency,
    languages: d.languages.map((l) => l.language).sort(),
    yearsExperience: d.yearsExperience,
    country: d.country ?? null,
    timeZone: d.user.timeZone,
    verified: true,
    rating: r?._count._all ? round1(r._avg.rating) : null,
    reviewCount: r?._count._all ?? 0,
    nextAvailableAt: next.get(d.id)?.toISOString() ?? null,
    // Public photo endpoint (listed doctors only), relative to the API base; carries the doctor id, never a storage key.
    photoUrl: d.user.avatarUpdatedAt ? `/v1/doctors/${d.id}/photo?v=${new Date(d.user.avatarUpdatedAt).getTime()}` : null,
    ...(full ? { bio: d.bio ?? '', qualifications: d.qualifications ?? null, verifiedSince: d.verifiedAt ? d.verifiedAt.toISOString().slice(0, 7) : null } : {}),
  };
}

const SORTERS = {
  rating: (a, b) => (b.rating ?? -1) - (a.rating ?? -1) || b.reviewCount - a.reviewCount || soonest(a, b),
  reviews: (a, b) => b.reviewCount - a.reviewCount || (b.rating ?? -1) - (a.rating ?? -1),
  priceLow: (a, b) => Number(a.consultationFee) - Number(b.consultationFee),
  priceHigh: (a, b) => Number(b.consultationFee) - Number(a.consultationFee),
  soonest: (a, b) => soonest(a, b),
};
function soonest(a, b) {
  if (a.nextAvailableAt === b.nextAvailableAt) return 0;
  if (!a.nextAvailableAt) return 1;
  if (!b.nextAvailableAt) return -1;
  return a.nextAvailableAt < b.nextAvailableAt ? -1 : 1;
}

async function enrich(client, doctors, now) {
  const ids = doctors.map((d) => d.id);
  const [ratingRows, nextRows] = await Promise.all([doctorRepository.ratingsFor(client, ids), doctorRepository.nextAvailableFor(client, ids, now)]);
  return { ratings: new Map(ratingRows.map((r) => [r.doctorId, r])), next: new Map(nextRows.map((r) => [r.doctorId, r._min.startAtUtc])) };
}

/** Search shows doctors with a free slot within this many days. */
export const SEARCH_HORIZON_DAYS = 30;

/** GET /api/v1/doctors: public search (verified, active, free slot in the next 30 days) with filters, sorting and paging. */
export async function searchDirectory({ q, specialtyId, language, minFee, maxFee, sort, page, pageSize }, { now = new Date(), client = prisma } = {}) {
  const where = {
    ...(specialtyId ? { specialtyId, specialty: { isActive: true } } : {}),
    ...(language ? { languages: { some: { language } } } : {}),
    ...(minFee !== undefined || maxFee !== undefined ? { consultationFee: { ...(minFee !== undefined ? { gte: minFee } : {}), ...(maxFee !== undefined ? { lte: maxFee } : {}) } } : {}),
    ...(q
      ? {
          OR: [
            { user: { fullName: { contains: q, mode: 'insensitive' } } },
            { specialty: { nameEn: { contains: q, mode: 'insensitive' } } },
            { specialty: { nameSo: { contains: q, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };
  const doctors = await doctorRepository.findPublicDoctors(client, where, MAX_MATCHES);
  const { ratings, next } = await enrich(client, doctors, now);
  // Requirement: only doctors with at least one free slot in the next 30 days appear in search.
  const horizon = now.getTime() + SEARCH_HORIZON_DAYS * 86_400_000;
  const bookable = doctors.filter((d) => next.get(d.id) && next.get(d.id).getTime() <= horizon);
  const items = bookable.map((d) => presentDoctor(d, ratings, next)).sort(SORTERS[sort]);
  const start = (page - 1) * pageSize;
  return { items: items.slice(start, start + pageSize), total: items.length, page, pageSize, sort };
}

/** GET /api/v1/doctors/:id: public profile of a listed doctor with rating, next slot and time zone. 404 otherwise. */
export async function getPublicDoctor(doctorId, { now = new Date(), client = prisma } = {}) {
  const doctor = await doctorRepository.findPublicDoctor(client, doctorId);
  if (!doctor) throw ApiError.notFound('Doctor not found');
  const { ratings, next } = await enrich(client, [doctor], now);
  const schedule = await doctorRepository.findActiveScheduleZone(client, doctor.id);
  return {
    ...presentDoctor(doctor, ratings, next, { full: true }),
    timeZone: schedule?.timeZone ?? doctor.user.timeZone,
    slotDurationMinutes: schedule?.slotDurationMinutes ?? null,
  };
}

/**
 * Open (AVAILABLE, future) slots of a public doctor, grouped by civil date in the VIEWER's zone `tz`
 * (date boundaries computed in that zone). Times are UTC ISO strings; clients format them in `tz`.
 */
export async function getPublicSlots(doctorId, { from, days, tz }, { now = new Date(), client = prisma } = {}) {
  const doctor = await doctorRepository.findPublicDoctor(client, doctorId);
  if (!doctor) throw ApiError.notFound('Doctor not found');
  const schedule = await doctorRepository.findActiveScheduleZone(client, doctor.id);
  const doctorTimeZone = schedule?.timeZone ?? doctor.user.timeZone;
  const timeZone = tz ?? doctorTimeZone;
  const today = dateInZone(now, timeZone);
  const fromDate = from && from > today ? from : today;
  const start = startOfDayUtc(fromDate, timeZone);
  const end = startOfDayUtc(addDays(fromDate, days), timeZone);
  const slots = await listSlotsInRange(client, doctor.id, { from: start, to: end, statuses: ['AVAILABLE'], startAfter: now });
  const grouped = groupSlotsByDay(slots, timeZone, fromDate, days).map((d) => ({ date: d.date, slots: d.slots.map(({ status, ...s }) => s) }));
  return { doctorId: doctor.id, timeZone, doctorTimeZone, from: fromDate, days: grouped };
}
