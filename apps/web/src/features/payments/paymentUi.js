/** Pure helpers for the payment screens (unit-tested). */

export const PROVIDERS = Object.freeze([
  { code: 'EVC_PLUS', name: 'EVC Plus' },
  { code: 'ZAAD', name: 'ZAAD' },
  { code: 'EDAHAB', name: 'eDahab' },
]);

export const PAYMENT_TONE = Object.freeze({ SUCCEEDED: 'green', PENDING: 'gold', FAILED: 'red', CANCELLED: 'neutral' });
export const REFUND_TONE = Object.freeze({ REQUESTED: 'gold', PROCESSING: 'blue', SUCCEEDED: 'green', FAILED: 'red', REJECTED: 'neutral' });

/** Normalises what a person types into +252…; returns null when it cannot be a Somali mobile number. */
export function normaliseWallet(input) {
  let v = String(input ?? '').replace(/[\s()-]/g, '');
  if (v.startsWith('00')) v = `+${v.slice(2)}`;
  if (/^0\d{8,9}$/.test(v)) v = `+252${v.slice(1)}`;
  if (/^[67]\d{7,8}$/.test(v)) v = `+252${v}`;
  if (/^252\d+$/.test(v)) v = `+${v}`;
  return /^\+252[679]\d{7,8}$/.test(v) ? v : null;
}

/** A fresh idempotency key per payment attempt. */
export const newAttemptKey = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`);

/** Saves a downloaded Blob as a file (never navigates the page). */
export function saveBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

const CODES = new Set(['PAYMENT_ALREADY_SUCCEEDED', 'PAYMENT_PENDING', 'APPOINTMENT_NOT_PAYABLE', 'WALLET_INVALID', 'IDEMPOTENCY_KEY_REUSED', 'RECEIPT_UNAVAILABLE', 'REFUND_NOT_REQUESTED', 'REFUND_NOT_FAILED', 'VALIDATION_ERROR', 'RATE_LIMITED', 'NETWORK_ERROR', 'NOT_FOUND']);
export const paymentErrorKey = (error) => `paymentErrors.${CODES.has(error?.code) ? error.code : 'GENERIC'}`;
