/**
 * Profile completeness — INFORMATIONAL ONLY. Nothing in the API reads these values to grant a
 * permission, publish availability, list a doctor or approve anything; verification stays an
 * administrator decision. Optional items only nudge; no user is ever forced to provide them.
 *
 * Each item: { key, done, required }. `percent` counts every item; `requiredDone` covers required ones.
 */
function summarise(items) {
  const done = items.filter((i) => i.done).length;
  return {
    percent: items.length ? Math.round((done / items.length) * 100) : 100,
    requiredDone: items.every((i) => i.done || !i.required),
    items: items.map(({ key, done: d, required }) => ({ key, done: d, required })),
  };
}

const filled = (v) => typeof v === 'string' ? v.trim().length > 0 : v != null;

/** `p` is the presented patient profile (see patientProfile.service.js). */
export function patientCompleteness(p) {
  return summarise([
    { key: 'fullName', done: filled(p.fullName), required: true },
    { key: 'contact', done: filled(p.email) || filled(p.phone), required: true },
    { key: 'photo', done: Boolean(p.photo?.hasPhoto), required: false },
    { key: 'dateOfBirth', done: filled(p.dateOfBirth), required: false },
    { key: 'sex', done: filled(p.sex), required: false },
    { key: 'address', done: filled(p.address?.city), required: false },
    { key: 'emergencyContact', done: filled(p.emergencyContact?.name) && filled(p.emergencyContact?.phone), required: false },
    { key: 'medicalHistory', done: (p.medicalHistoryCount ?? 0) > 0, required: false },
  ]);
}

/** `d` is the presented doctor profile (see doctorProfile.service.js). */
export function doctorCompleteness(d) {
  return summarise([
    { key: 'professionalName', done: filled(d.professionalName), required: true },
    { key: 'specialty', done: Boolean(d.specialty?.id), required: true },
    { key: 'consultationFee', done: filled(d.consultationFee), required: true },
    { key: 'bio', done: (d.bio ?? '').trim().length >= 50, required: true },
    { key: 'languages', done: (d.languages ?? []).length > 0, required: true },
    // Approved verification is shown as a requirement, but it is only ever granted by an administrator.
    { key: 'verification', done: d.status === 'VERIFIED', required: true },
    { key: 'photo', done: Boolean(d.photo?.hasPhoto), required: false },
    { key: 'qualifications', done: filled(d.qualifications), required: false },
    { key: 'yearsExperience', done: d.yearsExperience != null, required: false },
  ]);
}
