import * as applicationService from './doctorApplication.service.js';
import { sendPrivateDocument } from './doctorDocument.response.js';

/** Thin controllers for the applicant's own doctor application. */

/** GET /api/v1/specialties — list specialties. Thin HTTP adapter: validated input in, service result out as JSON. */
export async function listSpecialties(_req, res) {
  res.json({ data: await applicationService.listSpecialties() });
}

/** GET /api/v1/doctor-application, GET /api/v1/doctors/me/availability — get mine. Thin HTTP adapter: validated input in, service result out as JSON. */
export async function getMine(req, res) {
  res.json({ data: await applicationService.getMyApplication(req.auth) });
}

/** PUT /api/v1/doctor-application — save mine. Thin HTTP adapter: validated input in, service result out as JSON. */
export async function saveMine(req, res) {
  res.json({ data: await applicationService.saveMyApplication(req.auth, req.body) });
}

/** POST /api/v1/doctor-application/documents/:documentType — upload document. Thin HTTP adapter: validated input in, service result out as JSON. */
export async function uploadDocument(req, res) {
  const document = await applicationService.uploadMyDocument(req.auth, {
    documentType: req.params.documentType,
    buffer: req.body,
    fileName: String(req.get('x-file-name') ?? '').slice(0, 300),
  });
  res.status(201).json({ data: document });
}

/** GET /api/v1/doctor-application/documents/:documentId/file — download mine. Thin HTTP adapter: validated input in, service result out as JSON. */
export async function downloadMine(req, res) {
  sendPrivateDocument(res, await applicationService.getMyDocumentFile(req.auth, req.params.documentId));
}

/** POST /api/v1/doctor-application/documents/:documentType/upload-url — initiate upload. Thin HTTP adapter: validated input in, service result out as JSON. */
export async function initiateUpload(req, res) {
  res.status(201).json({ data: await applicationService.initiateMyDocumentUpload(req.auth, req.params.documentType, req.body) });
}

/** POST /api/v1/doctor-application/documents/:documentType/finalize — finalize upload. Thin HTTP adapter: validated input in, service result out as JSON. */
export async function finalizeUpload(req, res) {
  res.status(201).json({ data: await applicationService.finalizeMyDocumentUpload(req.auth, req.params.documentType, req.body.uploadToken) });
}

/** GET /api/v1/admin/doctor-applications/:doctorId/documents/:documentId/url, GET /api/v1/doctor-application/documents/:documentId/url — document url. Thin HTTP adapter: validated input in, service result out as JSON. */
export async function documentUrl(req, res) {
  res.set('Cache-Control', 'private, no-store');
  res.json({ data: await applicationService.getMyDocumentUrl(req.auth, req.params.documentId) });
}

/** POST /api/v1/doctor-application/submit — submit mine. Thin HTTP adapter: validated input in, service result out as JSON. */
export async function submitMine(req, res) {
  res.json({ data: await applicationService.submitMyApplication(req.auth) });
}
