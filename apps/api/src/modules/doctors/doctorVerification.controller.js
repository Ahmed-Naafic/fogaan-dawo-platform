import { sendPrivateDocument } from './doctorDocument.response.js';
import * as verificationService from './doctorVerification.service.js';

/** Thin controllers for administrator verification and the verified doctor's own profile. */

export async function list(req, res) {
  res.json({ data: await verificationService.listApplications({ tab: req.validatedQuery.tab }) });
}

export async function get(req, res) {
  res.json({ data: await verificationService.getApplication(req.params.doctorId) });
}

export async function documentUrl(req, res) {
  res.set('Cache-Control', 'private, no-store');
  res.json({ data: await verificationService.getApplicationDocumentUrl({ ...req.params, actorUserId: req.auth.user.id }) });
}

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

export async function myDoctorProfile(req, res) {
  res.json({ data: await verificationService.getMyDoctorProfile(req.auth) });
}
