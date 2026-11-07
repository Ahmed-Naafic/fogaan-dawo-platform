/**
 * Pure logic for the doctor application screens (unit-tested). Client checks mirror the API's Zod
 * rules for instant, translated feedback; the API stays the authority (including the real file type).
 */
export const DOCUMENT_TYPES = Object.freeze([
  { type: 'MEDICAL_LICENSE', required: true },
  { type: 'IDENTITY_PROOF', required: false },
  { type: 'QUALIFICATION', required: false },
]);
export const LANGUAGES = Object.freeze(['so', 'en', 'ar', 'sw', 'am', 'om', 'fr', 'it']);
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const ACCEPTED_FILES = '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png';

/** Application status → Badge tone (existing palette). */
export const STATUS_TONE = Object.freeze({ NOT_SUBMITTED: 'neutral', PENDING: 'gold', UNDER_REVIEW: 'blue', VERIFIED: 'green', REJECTED: 'red' });

export const emptyApplication = () => ({ professionalName: '', specialtyId: '', licenceNumber: '', licenceCountry: '', consultationFee: '', bio: '', yearsExperience: '', languages: [] });

export function formFromApplication(app) {
  if (!app) return emptyApplication();
  return {
    professionalName: app.professionalName ?? '',
    specialtyId: app.specialty?.id ?? '',
    licenceNumber: app.licenceNumber ?? '',
    licenceCountry: app.licenceCountry ?? '',
    consultationFee: app.consultationFee ?? '',
    bio: app.bio ?? '',
    yearsExperience: app.yearsExperience ?? '',
    languages: [...(app.languages ?? [])],
  };
}

const sameForm = (a, b) => JSON.stringify({ ...a, languages: [...a.languages].sort() }) === JSON.stringify({ ...b, languages: [...b.languages].sort() });
export const isDirty = (form, app) => !sameForm(form, formFromApplication(app));

/** Returns { errors: { field: translationKey }, payload } (payload is the PUT body, or null). */
export function validateApplication(values) {
  const errors = {};
  const name = String(values.professionalName ?? '').trim();
  if (name.length < 3 || name.length > 160) errors.professionalName = 'doctorValidation.professionalName';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(values.specialtyId ?? '')) errors.specialtyId = 'doctorValidation.specialty';
  const licence = String(values.licenceNumber ?? '').trim();
  if (licence.length < 3 || licence.length > 60 || !/^[A-Za-z0-9][A-Za-z0-9 ./-]*$/.test(licence)) errors.licenceNumber = 'doctorValidation.licenceNumber';
  const country = String(values.licenceCountry ?? '').trim();
  if (country.length < 2 || country.length > 100 || !/^[\p{L}][\p{L} .'-]*$/u.test(country)) errors.licenceCountry = 'doctorValidation.licenceCountry';
  const fee = Number(values.consultationFee);
  if (values.consultationFee === '' || !Number.isFinite(fee) || fee < 5 || fee > 200 || Math.round(fee * 100) / 100 !== fee) errors.consultationFee = 'doctorValidation.consultationFee';
  const bio = String(values.bio ?? '').trim();
  if (bio.length < 50 || bio.length > 2000) errors.bio = 'doctorValidation.bio';
  const years = values.yearsExperience === '' || values.yearsExperience == null ? null : Number(values.yearsExperience);
  if (years !== null && (!Number.isInteger(years) || years < 0 || years > 60)) errors.yearsExperience = 'doctorValidation.yearsExperience';
  const languages = [...new Set(values.languages ?? [])].filter((l) => LANGUAGES.includes(l));
  if (!languages.length) errors.languages = 'doctorValidation.languages';

  if (Object.keys(errors).length) return { errors, payload: null };
  return {
    errors,
    payload: {
      professionalName: name,
      specialtyId: values.specialtyId,
      licenceNumber: licence,
      licenceCountry: country,
      consultationFee: fee,
      bio,
      ...(years !== null ? { yearsExperience: years } : {}),
      languages,
    },
  };
}

/** Quick client-side file check (size + extension); the server re-checks the file's real bytes. */
export function checkFile(file) {
  if (!file) return 'doctorValidation.fileType';
  if (file.size === 0) return 'doctorValidation.fileEmpty';
  if (file.size > MAX_FILE_BYTES) return 'doctorValidation.fileTooLarge';
  if (!/\.(pdf|jpe?g|png)$/i.test(file.name ?? '')) return 'doctorValidation.fileType';
  return null;
}

const DOCTOR_ERROR_CODES = new Set([
  'APPLICATION_LOCKED',
  'APPLICATION_INCOMPLETE',
  'APPLICATION_NOT_FOUND',
  'SPECIALTY_NOT_FOUND',
  'FILE_TYPE_NOT_ALLOWED',
  'FILE_EMPTY',
  'PAYLOAD_TOO_LARGE',
  'SELF_REVIEW_FORBIDDEN',
  'INVALID_STATUS_TRANSITION',
  'VALIDATION_ERROR',
  'RATE_LIMITED',
  'NETWORK_ERROR',
]);

export const doctorErrorKey = (error) => `doctorErrors.${DOCTOR_ERROR_CODES.has(error?.code) ? error.code : 'GENERIC'}`;

/** API validation details → form fields to highlight. */
export const fieldsForApiError = (error) =>
  error?.code === 'SPECIALTY_NOT_FOUND' ? ['specialtyId'] : Array.isArray(error?.details) ? [...new Set(error.details.map((d) => String(d.path).split('.')[0]))] : [];

export const formatFileSize = (bytes) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

export const specialtyName = (specialty, lang) => (specialty ? (lang === 'so' ? specialty.nameSo : specialty.nameEn) : '');

/**
 * Opens a private document fetched with the bearer token, from a short-lived blob URL, in a new tab.
 * If the browser blocks the tab, the file is downloaded instead — the current page (e.g. an admin's
 * review in progress) is never navigated away.
 */
export async function openPrivateDocument(download, fileName = 'document') {
  const win = window.open('', '_blank'); // opened synchronously on the click, so pop-up blockers allow it
  try {
    const blob = await download();
    const url = URL.createObjectURL(blob);
    if (win) {
      win.opener = null;
      win.location.href = url;
    } else {
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
    }
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (error) {
    win?.close();
    throw error;
  }
}
