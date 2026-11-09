import * as historyService from '../medical-history/medicalHistory.service.js';
import * as doctorProfileService from './doctorProfile.service.js';
import * as patientProfileService from './patientProfile.service.js';
import * as photoService from './profilePhoto.service.js';

/** Thin controllers: the acting user is always req.auth; ids come only from validated params. */

/**
 * Image responses: fixed type, no sniffing, no script execution even if opened directly, and
 * caching scoped to who may see the photo (private for the owner, public for listed doctors — the
 * URLs are versioned, so a change is picked up immediately).
 */
function sendPhoto(res, { buffer, mimeType }, { isPublic }) {
  res.set({
    'Content-Type': mimeType,
    'Content-Length': String(buffer.length),
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Cross-Origin-Resource-Policy': isPublic ? 'cross-origin' : 'same-site',
    'Cache-Control': isPublic ? 'public, max-age=86400' : 'private, no-store',
    'Content-Disposition': 'inline; filename="photo.jpg"',
  });
  res.end(buffer);
}

/* ------------------------------------------------------------ patient profile */

/** GET /api/v1/me/profile — get patient profile. Thin HTTP adapter: validated input in, service result out as JSON. */
export async function getPatientProfile(req, res) {
  res.json({ data: await patientProfileService.getMyPatientProfile(req.auth) });
}

/** PATCH /api/v1/me/profile — update patient profile. Thin HTTP adapter: validated input in, service result out as JSON. */
export async function updatePatientProfile(req, res) {
  res.json({ data: await patientProfileService.updateMyPatientProfile(req.auth, req.body) });
}

/* ------------------------------------------------------------ photos */

/** PUT /api/v1/me/photo — upload photo. Thin HTTP adapter: validated input in, service result out as JSON. */
export async function uploadPhoto(req, res) {
  res.json({ data: await photoService.uploadMyPhoto(req.auth, req.body) });
}

/** DELETE /api/v1/me/photo — remove photo. Thin HTTP adapter: validated input in, service result out as JSON. */
export async function removePhoto(req, res) {
  res.json({ data: await photoService.removeMyPhoto(req.auth) });
}

/** GET /api/v1/me/photo — get my photo. Thin HTTP adapter: validated input in, service result out as JSON. */
export async function getMyPhoto(req, res) {
  sendPhoto(res, await photoService.getMyPhoto(req.auth), { isPublic: false });
}

/** GET /api/v1/doctors/:doctorId/photo — get public doctor photo. Thin HTTP adapter: validated input in, service result out as JSON. */
export async function getPublicDoctorPhoto(req, res) {
  sendPhoto(res, await photoService.getPublicDoctorPhoto(req.params.doctorId), { isPublic: true });
}

/* ------------------------------------------------------------ medical history */

/** GET /api/v1/me/medical-history — list history. Thin HTTP adapter: validated input in, service result out as JSON. */
export async function listHistory(req, res) {
  res.json({ data: await historyService.listMyHistory(req.auth, { includeArchived: req.validatedQuery?.includeArchived === 'true' }) });
}

/** POST /api/v1/me/medical-history — add history entry. Thin HTTP adapter: validated input in, service result out as JSON. */
export async function addHistoryEntry(req, res) {
  res.status(201).json({ data: await historyService.addMyEntry(req.auth, req.body) });
}

/** PATCH /api/v1/me/medical-history/entries/:entryId — update history entry. Thin HTTP adapter: validated input in, service result out as JSON. */
export async function updateHistoryEntry(req, res) {
  res.json({ data: await historyService.updateMyEntry(req.auth, req.params.entryId, req.body) });
}

/** POST /api/v1/me/medical-history/entries/:entryId/archive — archive history entry. Thin HTTP adapter: validated input in, service result out as JSON. */
export async function archiveHistoryEntry(req, res) {
  res.json({ data: await historyService.archiveMyEntry(req.auth, req.params.entryId) });
}

/** GET /api/v1/doctors/me/patients/:patientId/medical-history — get patient information for doctor. Thin HTTP adapter: validated input in, service result out as JSON. */
export async function getPatientInformationForDoctor(req, res) {
  res.set('Cache-Control', 'private, no-store');
  res.json({ data: await historyService.getPatientInformationForDoctor(req.auth, { patientId: req.params.patientId, appointmentId: req.validatedQuery.appointmentId }) });
}

/** GET /api/v1/doctors/me/patients/:patientId/photo — get patient photo for doctor. Thin HTTP adapter: validated input in, service result out as JSON. */
export async function getPatientPhotoForDoctor(req, res) {
  sendPhoto(res, await historyService.getPatientPhotoForDoctor(req.auth, { patientId: req.params.patientId, appointmentId: req.validatedQuery.appointmentId }), { isPublic: false });
}

/* ------------------------------------------------------------ doctor professional profile */

/** GET /api/v1/doctors/me/profile — get doctor profile. Thin HTTP adapter: validated input in, service result out as JSON. */
export async function getDoctorProfile(req, res) {
  res.json({ data: await doctorProfileService.getMyProfessionalProfile(req.auth) });
}

/** PATCH /api/v1/doctors/me/profile — update doctor profile. Thin HTTP adapter: validated input in, service result out as JSON. */
export async function updateDoctorProfile(req, res) {
  res.json({ data: await doctorProfileService.updateMyProfessionalProfile(req.auth, req.body) });
}

/** POST /api/v1/doctors/me/licence — replace licence. Thin HTTP adapter: validated input in, service result out as JSON. */
export async function replaceLicence(req, res) {
  const { licenceNumber, licenceCountry } = req.validatedQuery;
  res.json({ data: await doctorProfileService.replaceMyLicence(req.auth, { buffer: req.body, fileName: String(req.get('x-file-name') ?? '').slice(0, 300), licenceNumber, licenceCountry }) });
}
