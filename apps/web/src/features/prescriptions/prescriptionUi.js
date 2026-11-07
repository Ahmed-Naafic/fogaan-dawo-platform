/**
 * Prescription / document UI helpers: status tones, client checks mirroring the API (the API remains the
 * authority), error-code → translation key, file helpers. No medicine is ever suggested.
 */

export const STATUS_TONE = Object.freeze({ DRAFT: 'neutral', VALID: 'green', CANCELLED: 'red', REPLACED: 'gold' });
export const MAX_ITEMS = 10;
export const DOCUMENT_CATEGORIES = Object.freeze(['LAB_RESULT', 'MEDICAL_REPORT', 'REFERRAL_LETTER', 'DIAGNOSTIC_REPORT', 'SCANNED_DOCUMENT', 'OTHER']);
export const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
export const DOCUMENT_ACCEPT = '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png';

const ERROR_CODES = new Set([
  'VALIDATION_ERROR',
  'RATE_LIMITED',
  'NETWORK_ERROR',
  'PRESCRIPTION_NOT_FOUND',
  'PRESCRIPTION_FORBIDDEN',
  'DOCTOR_NOT_ACTIVE',
  'PRESCRIPTION_WINDOW_CLOSED',
  'PRESCRIPTION_NOT_DRAFT',
  'PRESCRIPTION_NOT_VALID',
  'PRESCRIPTION_ALREADY_REPLACED',
  'PRESCRIPTION_PDF_UNAVAILABLE',
  'PRESCRIPTION_PDF_INTEGRITY',
  'DOCUMENT_NOT_FOUND',
  'FILE_EMPTY',
  'PAYLOAD_TOO_LARGE',
  'FILE_TYPE_NOT_ALLOWED',
  'FILE_MALFORMED',
  'DOCUMENT_ARCHIVED',
  'DOCUMENT_FORBIDDEN',
  'CONSULTATION_NOT_ELIGIBLE',
  'DOCUMENT_INTEGRITY',
  'UPLOAD_INTENT_INVALID',
  'UPLOAD_NOT_FOUND',
  'UPLOAD_ALREADY_FINALISED',
  'UPLOAD_FAILED',
  'DOWNLOAD_LINK_INVALID',
  'DOWNLOAD_FAILED',
]);

export const rxErrorKey = (error) =>
  `rxErrors.${ERROR_CODES.has(error?.code) ? error.code : error?.status === 404 ? 'NOT_FOUND' : error?.status === 403 ? 'FORBIDDEN' : 'GENERIC'}`;

export const emptyItem = () => ({ medicineName: '', dose: '', frequency: '', duration: '', quantity: '', instructions: '', warnings: '' });

export const itemsFrom = (items = []) =>
  items.map((it) => ({
    medicineName: it.medicineName ?? '',
    dose: it.dose ?? '',
    frequency: it.frequency ?? '',
    duration: it.duration ?? '',
    quantity: it.quantity ?? '',
    instructions: it.instructions ?? '',
    warnings: it.warnings ?? '',
  }));

const LIMITS = { medicineName: [2, 180], dose: [1, 120], frequency: [1, 120], duration: [1, 120], quantity: [0, 60], instructions: [0, 1000], warnings: [0, 1000] };

/** Returns { errors: { 'items.0.dose': key, … }, payload } — payload only when valid. */
export function validatePrescription({ items, generalNotes = '' }) {
  const errors = {};
  if (!items.length) errors.items = 'rx.errors.noItems';
  if (items.length > MAX_ITEMS) errors.items = 'rx.errors.tooManyItems';
  items.forEach((it, i) => {
    for (const [field, [min, max]] of Object.entries(LIMITS)) {
      const v = String(it[field] ?? '').trim();
      if ((min > 0 && v.length < min) || v.length > max) errors[`items.${i}.${field}`] = `rx.errors.${field}`;
    }
  });
  if (generalNotes.trim().length > 2000) errors.generalNotes = 'rx.errors.notes';
  if (Object.keys(errors).length) return { errors, payload: null };
  const clean = (v) => (String(v ?? '').trim() ? String(v).trim() : null);
  return {
    errors,
    payload: {
      items: items.map((it) => ({
        medicineName: it.medicineName.trim(),
        dose: it.dose.trim(),
        frequency: it.frequency.trim(),
        duration: it.duration.trim(),
        quantity: clean(it.quantity),
        instructions: clean(it.instructions),
        warnings: clean(it.warnings),
      })),
      generalNotes: clean(generalNotes),
    },
  };
}

export const validReason = (reason) => {
  const r = String(reason ?? '').trim();
  return r.length >= 10 && r.length <= 500;
};

export function checkDocumentFile(file) {
  if (!file) return 'rx.errors.chooseFile';
  if (file.size === 0) return 'rxErrors.FILE_EMPTY';
  if (file.size > DOCUMENT_MAX_BYTES) return 'rxErrors.PAYLOAD_TOO_LARGE';
  if (file.type && !['application/pdf', 'image/jpeg', 'image/png'].includes(file.type)) return 'rxErrors.FILE_TYPE_NOT_ALLOWED';
  return null;
}

export const formatBytes = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Opens a private blob (PDF/image) in a new tab, or downloads it. */
export async function openBlob(load, { fileName = 'document', download = false } = {}) {
  const blob = await load();
  const url = URL.createObjectURL(blob);
  const save = () => {
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };
  if (download) save();
  else if (!window.open(url, '_blank')) save(); // pop-up blocked (opened after an await) → download instead
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Prints a private PDF through a hidden frame (falls back to opening it). */
export async function printBlob(load) {
  const blob = await load();
  const url = URL.createObjectURL(blob);
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  frame.src = url;
  document.body.appendChild(frame);
  frame.onload = () => {
    try {
      frame.contentWindow.focus();
      frame.contentWindow.print();
    } catch {
      window.open(url, '_blank', 'noopener');
    }
    setTimeout(() => {
      frame.remove();
      URL.revokeObjectURL(url);
    }, 60_000);
  };
}
