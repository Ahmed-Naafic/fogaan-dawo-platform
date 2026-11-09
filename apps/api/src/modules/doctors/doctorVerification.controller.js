import { sendPrivateDocument } from './doctorDocument.response.js';
import * as verificationService from './doctorVerification.service.js';

/** Thin controllers for administrator verification and the verified doctor's own profile. */

/** GET /api/v1/admin/doctor-applications, GET /api/v1/admin/doctors — list. Thin HTTP adapter: validated input in, service result out as JSON. */
export async function list(req, res) {
  res.json({ data: await verificationService.listApplications({ tab: req.validatedQuery.tab }) });
}

/** GET /api/v1/admin/doctor-applications/:doctorId, GET /api/v1/doctors/:doctorId — get. Thin HTTP adapter: validated input in, service result out as JSON. */
export async function get(req, res) {
  res.json({ data: await verificationService.getApplication(req.params.doctorId) });
}

/** GET /api/v1/admin/doctor-applications/:doctorId/documents/:documentId/url, GET /api/v1/doctor-application/documents/:documentId/url — document url. Thin HTTP adapter: validated input in, service result out as JSON. */
export async function documentUrl(req, res) {
  res.set('Cache-Control', 'private, no-store');
  res.json({ data: await verificationService.getApplicationDocumentUrl({ ...req.params, actorUserId: req.auth.user.id }) });
}

/** GET /api/v1/admin/doctor-applications/:doctorId/documents/:documentId/file — download document. Thin HTTP adapter: validated input in, service result out as JSON. */
export async function downloadDocument(req, res) {
  sendPrivateDocument(res, await verificationService.getApplicationDocumentFile(req.params));
}

const decide = (decision, notesFrom) => async (req, res) => {
  const data = await verificationService.decideApplication({
    doctorId: req.params.doctorId,
    reviewerUserId: req.auth.user.id,
    decision,
    notes: notesFrom(req.body),
  });
  res.json({ data });
};

export const startReview = decide('START_REVIEW', () => null);
export const approve = decide('APPROVE', (body) => body.notes ?? null);
export const reject = decide('REJECT', (body) => body.reason);

/** GET /api/v1/doctors/me — my doctor profile. Thin HTTP adapter: validated input in, service result out as JSON. */
export async function myDoctorProfile(req, res) {
  res.json({ data: await verificationService.getMyDoctorProfile(req.auth) });
}
