import { APPLICATION_DOCUMENT_TYPES, EDITABLE_STATUSES, REQUIRED_DOCUMENT_TYPES } from './doctorApplication.constants.js';

/** Shapes doctor-application records for API responses. Storage keys are never included. */

/** Safe shape of a doctor document (type, version, file name, size, dates); never the storage key. */
export const presentDocument = (d) => ({
  id: d.id,
  documentType: d.documentType,
  fileName: d.fileName,
  mimeType: d.mimeType,
  fileSize: d.fileSize,
  versionNumber: d.versionNumber,
  isCurrent: d.isCurrent,
  uploadedAt: d.uploadedAt,
});

/** Profile completion: required items gate submission; optional documents only raise the percentage. */
export function completionOf(profile) {
  const current = new Set(profile.documents.filter((d) => d.isCurrent).map((d) => d.documentType));
  const items = [
    { key: 'professionalName', done: Boolean(profile.user?.fullName?.trim()), required: true },
    { key: 'specialty', done: Boolean(profile.specialtyId), required: true },
    { key: 'licence', done: Boolean(profile.licenceNumber && profile.licenceCountry), required: true },
    { key: 'consultationFee', done: profile.consultationFee != null, required: true },
    { key: 'bio', done: (profile.bio ?? '').trim().length >= 50, required: true },
    { key: 'languages', done: profile.languages.length > 0, required: true },
    ...APPLICATION_DOCUMENT_TYPES.map((type) => ({ key: `document:${type}`, done: current.has(type), required: REQUIRED_DOCUMENT_TYPES.includes(type) })),
  ];
  const done = items.filter((i) => i.done).length;
  return {
    percent: Math.round((done / items.length) * 100),
    missing: items.filter((i) => !i.done).map((i) => ({ key: i.key, required: i.required })),
    readyToSubmit: items.every((i) => i.done || !i.required),
  };
}

function presentHistory(requests) {
  return requests.map((r) => ({
    id: r.id,
    status: r.status,
    submittedAt: r.submittedAt,
    resolvedAt: r.resolvedAt,
    notes: r.notes,
    reviews: r.reviews.map((v) => ({ id: v.id, status: v.status, notes: v.notes, createdAt: v.createdAt, reviewer: v.reviewer ? { id: v.reviewer.id, fullName: v.reviewer.fullName } : null })),
  }));
}

/** The applicant's own view (also used for the doctor dashboard). */
export function presentApplication(profile) {
  const latest = profile.verificationRequests[0] ?? null;
  const rejection = latest?.status === 'REJECTED' ? [...latest.reviews].reverse().find((v) => v.status === 'REJECTED') : null;
  return {
    id: profile.id,
    status: profile.verificationStatus,
    accountStatus: profile.accountStatus,
    editable: EDITABLE_STATUSES.includes(profile.verificationStatus),
    professionalName: profile.user.fullName,
    specialty: profile.specialty,
    licenceNumber: profile.licenceNumber,
    licenceCountry: profile.licenceCountry,
    consultationFee: profile.consultationFee.toFixed(2),
    currency: profile.currency,
    bio: profile.bio,
    yearsExperience: profile.yearsExperience,
    country: profile.country ?? null,
    qualifications: profile.qualifications ?? null,
    languages: profile.languages.map((l) => l.language),
    verifiedAt: profile.verifiedAt,
    documents: profile.documents.filter((d) => d.isCurrent).map(presentDocument),
    documentHistory: profile.documents.map(presentDocument),
    latestRequest: latest ? { id: latest.id, status: latest.status, submittedAt: latest.submittedAt, resolvedAt: latest.resolvedAt } : null,
    rejectionReason: rejection?.notes ?? null,
    history: presentHistory(profile.verificationRequests),
    completion: completionOf(profile),
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}

/** The administrator's view adds the applicant's account details. */
export function presentApplicationForAdmin(profile) {
  return {
    ...presentApplication(profile),
    applicant: { id: profile.user.id, fullName: profile.user.fullName, email: profile.user.email, phone: profile.user.phone, status: profile.user.status },
  };
}
