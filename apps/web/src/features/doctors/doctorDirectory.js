/** Pure helpers for the public doctor directory (unit-tested). */

export const SORTS = Object.freeze(['rating', 'priceLow', 'priceHigh', 'reviews', 'soonest']);
export const FEE_RANGES = Object.freeze({
  any: {},
  under15: { maxFee: 15 },
  '15to30': { minFee: 15, maxFee: 30 },
  '30to60': { minFee: 30, maxFee: 60 },
  over60: { minFee: 60 },
});
export const PAGE_SIZE = 12;

/** Landing-page specialty keys (design data) → the specialty's English name in the database. */
const LEGACY_SPECIALTY_KEYS = Object.freeze({
  general: 'General Practice',
  cardiology: 'Cardiology',
  dermatology: 'Dermatology',
  pediatrics: 'Pediatrics',
  gynecology: "Women's Health",
  mentalHealth: 'Mental Health',
  nutrition: 'Nutrition',
  orthopedics: 'Orthopedics',
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ?specialty= accepts a specialty id, or a landing-page key (e.g. "cardiology"). */
export function resolveSpecialty(param, specialties) {
  if (!param || param === 'all') return '';
  if (UUID.test(param)) return specialties.some((s) => s.id === param) || !specialties.length ? param : '';
  const name = LEGACY_SPECIALTY_KEYS[param];
  return specialties.find((s) => s.nameEn === name)?.id ?? '';
}

/** URL search params → API query. Unknown or invalid values fall back to defaults. */
export function directoryQuery(params, specialties) {
  const fee = FEE_RANGES[params.get('fee')] ? params.get('fee') : 'any';
  const sort = SORTS.includes(params.get('sort')) ? params.get('sort') : 'rating';
  const page = Math.max(1, Number.parseInt(params.get('page') ?? '1', 10) || 1);
  return {
    q: (params.get('q') ?? '').trim().slice(0, 100) || undefined,
    specialtyId: resolveSpecialty(params.get('specialty'), specialties) || undefined,
    language: params.get('language') || undefined,
    ...FEE_RANGES[fee],
    sort,
    page,
    pageSize: PAGE_SIZE,
  };
}

export const formatFee = (amount, currency = 'USD') => {
  const n = Number(amount);
  const value = Number.isInteger(n) ? String(n) : n.toFixed(2);
  return currency === 'USD' ? `$${value}` : `${value} ${currency}`;
};

export const specialtyLabel = (specialty, lang) => (specialty ? (lang === 'so' ? specialty.nameSo : specialty.nameEn) : '');
