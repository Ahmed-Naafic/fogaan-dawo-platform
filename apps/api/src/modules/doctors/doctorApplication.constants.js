/**
 * Doctor application lifecycle (existing schema, no new models):
 *
 *   DoctorProfile.verificationStatus   NOT_SUBMITTED ─submit→ PENDING ─start review→ UNDER_REVIEW
 *                                       PENDING | UNDER_REVIEW ─approve→ VERIFIED (+ DOCTOR role granted)
 *                                       PENDING | UNDER_REVIEW ─reject→  REJECTED ─edit & resubmit→ PENDING …
 *   VerificationRequest                one row per submission (history), status PENDING → UNDER_REVIEW →
 *                                       APPROVED | REJECTED; `notes` holds the rejection reason
 *   VerificationReview                 one row per admin action (who, what, when, why)
 */

/** The applicant may edit / upload / submit only in these states. */
export const EDITABLE_STATUSES = Object.freeze(['NOT_SUBMITTED', 'REJECTED']);

/** Statuses the admin "Pending" tab shows (Under review is a badge, matching the approved 3-tab design). */
export const ADMIN_TABS = Object.freeze({
  pending: ['PENDING', 'UNDER_REVIEW'],
  verified: ['VERIFIED'],
  rejected: ['REJECTED'],
});

/** Document types an applicant can upload; the medical licence is required. */
export const APPLICATION_DOCUMENT_TYPES = Object.freeze(['MEDICAL_LICENSE', 'IDENTITY_PROOF', 'QUALIFICATION']);
export const REQUIRED_DOCUMENT_TYPES = Object.freeze(['MEDICAL_LICENSE']);

/** Languages a doctor can list (ISO 639-1). */
export const DOCTOR_LANGUAGES = Object.freeze(['so', 'en', 'ar', 'sw', 'am', 'om', 'fr', 'it']);

export const DoctorErrorCode = Object.freeze({
  applicationNotFound: 'APPLICATION_NOT_FOUND',
  applicationLocked: 'APPLICATION_LOCKED',
  applicationIncomplete: 'APPLICATION_INCOMPLETE',
  specialtyNotFound: 'SPECIALTY_NOT_FOUND',
  fileTypeNotAllowed: 'FILE_TYPE_NOT_ALLOWED',
  fileEmpty: 'FILE_EMPTY',
  selfReview: 'SELF_REVIEW_FORBIDDEN',
  invalidTransition: 'INVALID_STATUS_TRANSITION',
  documentNotFound: 'DOCUMENT_NOT_FOUND',
});
