/**
 * Shared helpers for the profile pages: form ↔ API conversion, client-side checks that mirror the API's
 * rules (the server remains the authority), and error-code → translation-key mapping.
 */

export const SEX_VALUES = Object.freeze(['FEMALE', 'MALE', 'PREFER_NOT_TO_SAY']);
export const HISTORY_TYPES = Object.freeze(['ALLERGY', 'CONDITION', 'MEDICATION', 'SURGERY', 'FAMILY_HISTORY', 'OTHER']);
export const PHOTO_MAX_BYTES = 2 * 1024 * 1024;
export const PHOTO_ACCEPT = 'image/jpeg,image/png,.jpg,.jpeg,.png';

const PROFILE_ERROR_CODES = new Set([
  'VALIDATION_ERROR',
  'RATE_LIMITED',
  'NETWORK_ERROR',
  'PATIENT_PROFILE_REQUIRED',
  'NAME_LOCKED_BY_DOCTOR_PROFILE',
  'HISTORY_ENTRY_ARCHIVED',
  'HISTORY_DOCTOR_ENTRY_READ_ONLY',
  'DOCTOR_PROFILE_LOCKED',
  'FILE_EMPTY',
  'PAYLOAD_TOO_LARGE',
  'PHOTO_TYPE_NOT_ALLOWED',
  'PHOTO_INVALID',
  'PHOTO_DIMENSIONS',
  'FILE_TYPE_NOT_ALLOWED',
  'CURRENT_PASSWORD_INVALID',
  'PASSWORD_NOT_SET',
]);

export const profileErrorKey = (error) => `profileErrors.${PROFILE_ERROR_CODES.has(error?.code) ? error.code : error?.status === 403 ? 'FORBIDDEN' : error?.status === 404 ? 'NOT_FOUND' : 'GENERIC'}`;

/** Field names the API flagged in a VALIDATION_ERROR (details: [{ path, message }]). */
export const apiFieldErrors = (error) =>
  error?.code === 'VALIDATION_ERROR' && Array.isArray(error.details)
    ? Object.fromEntries(error.details.map((d) => [String(d.path).split('.')[0], 'profileErrors.FIELD_INVALID']))
    : error?.code === 'CURRENT_PASSWORD_INVALID'
      ? { currentPassword: 'profileErrors.CURRENT_PASSWORD_INVALID' }
      : {};

const PHONE = /^\+[1-9]\d{7,14}$/;
export const normalizePhone = (value) => {
  let v = String(value ?? '').trim().replace(/[\s().-]/g, '');
  if (v.startsWith('00')) v = `+${v.slice(2)}`;
  return v;
};
const today = () => new Date().toISOString().slice(0, 10);
const validDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(new Date(`${v}T00:00:00Z`).getTime()) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

/* ------------------------------------------------------------ patient profile form */

export function patientForm(profile) {
  return {
    fullName: profile?.fullName ?? '',
    preferredLanguage: profile?.preferredLanguage ?? 'en',
    dateOfBirth: profile?.dateOfBirth ?? '',
    sex: profile?.sex ?? '',
    city: profile?.address?.city ?? '',
    addressLine: profile?.address?.addressLine ?? '',
    emergencyName: profile?.emergencyContact?.name ?? '',
    emergencyRelationship: profile?.emergencyContact?.relationship ?? '',
    emergencyPhone: profile?.emergencyContact?.phone ?? '',
  };
}

/** Returns { errors, payload } — payload holds only fields that changed (never email/phone/role). */
export function validatePatientForm(form, original) {
  const errors = {};
  const name = form.fullName.trim();
  if (name.length < 2 || name.length > 160) errors.fullName = 'profile.errors.fullName';
  if (form.dateOfBirth && (!validDate(form.dateOfBirth) || form.dateOfBirth < '1900-01-01' || form.dateOfBirth > today())) errors.dateOfBirth = 'profile.errors.dateOfBirth';
  const city = form.city.trim();
  const line = form.addressLine.trim();
  if ((city || line) && (city.length < 2 || city.length > 100)) errors.city = 'profile.errors.city';
  if (line.length > 255) errors.addressLine = 'profile.errors.addressLine';
  const ec = { name: form.emergencyName.trim(), relationship: form.emergencyRelationship.trim(), phone: normalizePhone(form.emergencyPhone) };
  const anyEc = ec.name || ec.relationship || form.emergencyPhone.trim();
  if (anyEc) {
    if (ec.name.length < 2 || ec.name.length > 160) errors.emergencyName = 'profile.errors.emergencyName';
    if (ec.relationship.length < 2 || ec.relationship.length > 60) errors.emergencyRelationship = 'profile.errors.emergencyRelationship';
    if (!PHONE.test(ec.phone)) errors.emergencyPhone = 'profile.errors.phone';
  }
  if (Object.keys(errors).length) return { errors, payload: null };

  const before = patientForm(original);
  const payload = {};
  if (name !== before.fullName) payload.fullName = name;
  if (form.preferredLanguage !== before.preferredLanguage) payload.preferredLanguage = form.preferredLanguage;
  if (form.dateOfBirth !== before.dateOfBirth) payload.dateOfBirth = form.dateOfBirth || null;
  if (form.sex !== before.sex) payload.sex = form.sex || null;
  if (city !== before.city || line !== before.addressLine) payload.address = city ? { city, addressLine: line || null } : null;
  if (ec.name !== before.emergencyName || ec.relationship !== before.emergencyRelationship || ec.phone !== normalizePhone(before.emergencyPhone)) {
    payload.emergencyContact = anyEc ? ec : null;
  }
  return { errors: {}, payload };
}

/* ------------------------------------------------------------ medical history */

export const emptyEntry = () => ({ entryType: 'ALLERGY', title: '', description: '', recordedAt: '' });

export const entryForm = (entry) => ({ entryType: entry.entryType, title: entry.title, description: entry.description ?? '', recordedAt: entry.recordedAt ? entry.recordedAt.slice(0, 10) : '' });

export function validateEntry(form) {
  const errors = {};
  const title = form.title.trim();
  if (!HISTORY_TYPES.includes(form.entryType)) errors.entryType = 'medical.errors.type';
  if (title.length < 2 || title.length > 180) errors.title = 'medical.errors.title';
  if (form.description.length > 4000) errors.description = 'medical.errors.description';
  if (form.recordedAt && (!validDate(form.recordedAt) || form.recordedAt < '1900-01-01' || form.recordedAt > today())) errors.recordedAt = 'medical.errors.date';
  if (Object.keys(errors).length) return { errors, payload: null };
  return { errors, payload: { entryType: form.entryType, title, description: form.description.trim() || null, recordedAt: form.recordedAt || null } };
}

/** Only the fields that changed (PATCH). */
export function entryChanges(payload, entry) {
  const before = { entryType: entry.entryType, title: entry.title, description: entry.description ?? null, recordedAt: entry.recordedAt ? entry.recordedAt.slice(0, 10) : null };
  return Object.fromEntries(Object.entries(payload).filter(([k, v]) => v !== before[k]));
}

/* ------------------------------------------------------------ doctor profile */

export const doctorForm = (p) => ({
  bio: p?.bio ?? '',
  qualifications: p?.qualifications ?? '',
  yearsExperience: p?.yearsExperience ?? '',
  country: p?.country ?? '',
  consultationFee: p?.consultationFee ?? '',
  languages: p?.languages ?? [],
});

export function validateDoctorForm(form, original) {
  const errors = {};
  const bio = form.bio.trim();
  if (bio.length < 50 || bio.length > 2000) errors.bio = 'myDoctorProfile.errors.bio';
  if (form.qualifications.trim().length > 1000) errors.qualifications = 'myDoctorProfile.errors.qualifications';
  const years = form.yearsExperience === '' ? null : Number(form.yearsExperience);
  if (years !== null && (!Number.isInteger(years) || years < 0 || years > 60)) errors.yearsExperience = 'myDoctorProfile.errors.years';
  const country = (form.country ?? '').trim();
  if (country && (country.length < 2 || country.length > 100)) errors.country = 'myDoctorProfile.errors.country';
  const fee = Number(form.consultationFee);
  if (!Number.isFinite(fee) || fee < 5 || fee > 200 || Math.round(fee * 100) / 100 !== fee) errors.consultationFee = 'myDoctorProfile.errors.fee';
  if (!form.languages.length) errors.languages = 'myDoctorProfile.errors.languages';
  if (Object.keys(errors).length) return { errors, payload: null };
  const before = doctorForm(original);
  const payload = {};
  if (bio !== (before.bio ?? '').trim()) payload.bio = bio;
  const q = form.qualifications.trim();
  if (q !== (before.qualifications ?? '').trim()) payload.qualifications = q || null;
  if (years !== (before.yearsExperience === '' ? null : before.yearsExperience)) payload.yearsExperience = years;
  if (country !== (before.country ?? '').trim()) payload.country = country || null;
  if (fee.toFixed(2) !== String(before.consultationFee)) payload.consultationFee = fee;
  if ([...form.languages].sort().join() !== [...before.languages].sort().join()) payload.languages = form.languages;
  return { errors, payload };
}

/* ------------------------------------------------------------ files */

/** Quick client-side check (the server re-validates the actual bytes). Returns a translation key or null. */
export function checkPhotoFile(file) {
  if (!file) return null;
  if (file.size === 0) return 'profileErrors.FILE_EMPTY';
  if (file.size > PHOTO_MAX_BYTES) return 'profileErrors.PAYLOAD_TOO_LARGE';
  if (file.type && !['image/jpeg', 'image/png'].includes(file.type)) return 'profileErrors.PHOTO_TYPE_NOT_ALLOWED';
  return null;
}

export const dateOnly = (iso, locale) => (iso ? new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso).toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric', timeZone: iso.length === 10 ? 'UTC' : undefined }) : '');
