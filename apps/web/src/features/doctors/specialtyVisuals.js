/**
 * Presentation only: icon and colour for a specialty, keyed by its English name in the database.
 * Names, ids and doctor counts always come from the API; a specialty without an entry here gets the
 * default stethoscope tile. `featured` specialties are the quick filters on the patient dashboard.
 */
const VISUALS = Object.freeze({
  'General Practice': { icon: 'Stethoscope', tone: 'teal', featured: 1 },
  Cardiology: { icon: 'HeartPulse', tone: 'rose', featured: 2 },
  Dermatology: { icon: 'Sparkles', tone: 'blue', featured: 3 },
  Pediatrics: { icon: 'Baby', tone: 'purple', featured: 4 },
  "Women's Health": { icon: 'Flower2', tone: 'rose' },
  'Mental Health': { icon: 'Brain', tone: 'gold' },
  Nutrition: { icon: 'Apple', tone: 'green' },
  Orthopedics: { icon: 'Bone', tone: 'blue' },
});
const DEFAULT = Object.freeze({ icon: 'Stethoscope', tone: 'teal' });

export const specialtyVisual = (specialty) => VISUALS[specialty?.nameEn] ?? DEFAULT;

/** Up to `n` quick-filter specialties: the featured ones that exist, then the ones with most doctors. */
export function featuredSpecialties(specialties, n = 4) {
  const rank = (s) => VISUALS[s.nameEn]?.featured ?? Infinity;
  return [...specialties].sort((a, b) => rank(a) - rank(b) || b.doctors - a.doctors).slice(0, n);
}
