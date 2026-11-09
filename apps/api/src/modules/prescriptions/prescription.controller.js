import * as summaryService from '../consultations/consultationSummary.service.js';
import * as service from './prescription.service.js';

/** Thin controllers: the actor is always req.auth; ids only from validated params. */

/** POST /api/v1/consultations/:consultationId/prescriptions — create draft. Thin HTTP adapter: validated input in, service result out as JSON. */
export async function createDraft(req, res) {
  res.status(201).json({ data: await service.createDraft(req.auth, req.params.consultationId, req.body) });
}
/** GET /api/v1/consultations/:consultationId/prescriptions — list for consultation. Thin HTTP adapter: validated input in, service result out as JSON. */
export async function listForConsultation(req, res) {
  res.json({ data: await service.listForConsultation(req.auth, req.params.consultationId) });
}
/** GET /api/v1/prescriptions/:prescriptionId — get. Thin HTTP adapter: validated input in, service result out as JSON. */
export async function get(req, res) {
  res.set('Cache-Control', 'private, no-store');
  res.json({ data: await service.getPrescription(req.auth, req.params.prescriptionId) });
}
/** PATCH /api/v1/prescriptions/:prescriptionId — update draft. Thin HTTP adapter: validated input in, service result out as JSON. */
export async function updateDraft(req, res) {
  res.json({ data: await service.updateDraft(req.auth, req.params.prescriptionId, req.body) });
}
/** DELETE /api/v1/prescriptions/:prescriptionId — discard draft. Thin HTTP adapter: validated input in, service result out as JSON. */
export async function discardDraft(req, res) {
  res.json({ data: await service.discardDraft(req.auth, req.params.prescriptionId) });
}
/** POST /api/v1/prescriptions/:prescriptionId/issue — issue. Thin HTTP adapter: validated input in, service result out as JSON. */
export async function issue(req, res) {
  res.json({ data: await service.issueDraft(req.auth, req.params.prescriptionId) });
}
/** POST /api/v1/prescriptions/:prescriptionId/replace — replace. Thin HTTP adapter: validated input in, service result out as JSON. */
export async function replace(req, res) {
  res.status(201).json({ data: await service.replacePrescription(req.auth, req.params.prescriptionId, req.body) });
}
/** POST /api/v1/prescriptions/:prescriptionId/cancel — cancel. Thin HTTP adapter: validated input in, service result out as JSON. */
export async function cancel(req, res) {
  res.json({ data: await service.cancelPrescription(req.auth, req.params.prescriptionId, req.body) });
}
/** GET /api/v1/prescriptions/:prescriptionId/pdf — pdf. Thin HTTP adapter: validated input in, service result out as JSON. */
export async function pdf(req, res) {
  const { buffer, fileName } = await service.getPdf(req.auth, req.params.prescriptionId);
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Length': String(buffer.length),
    'Content-Disposition': `${req.query.download === '1' ? 'attachment' : 'inline'}; filename="${fileName.replace(/[^A-Za-z0-9.-]/g, '')}"`,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; plugin-types application/pdf",
  });
  res.end(buffer);
}
/** GET /api/v1/me/prescriptions — list mine. Thin HTTP adapter: validated input in, service result out as JSON. */
export async function listMine(req, res) {
  res.json({ data: await service.listMine(req.auth, req.validatedQuery) });
}
/** GET /api/v1/doctors/me/prescriptions — list for doctor. Thin HTTP adapter: validated input in, service result out as JSON. */
export async function listForDoctor(req, res) {
  res.json({ data: await service.listForDoctor(req.auth, req.validatedQuery) });
}
/** GET /api/v1/consultations/:consultationId/summary — summary. Thin HTTP adapter: validated input in, service result out as JSON. */
export async function summary(req, res) {
  res.set('Cache-Control', 'private, no-store');
  res.json({ data: await summaryService.getConsultationSummary(req.auth, req.params.consultationId) });
}
/** GET /api/v1/me/consultation-summaries — list my summaries. Thin HTTP adapter: validated input in, service result out as JSON. */
export async function listMySummaries(req, res) {
  res.set('Cache-Control', 'private, no-store');
  res.json({ data: await summaryService.listMySummaries(req.auth) });
}
/** Public: limited verification info only (see verifyPrescriptionToken). */
export async function verify(req, res) {
  res.set('Cache-Control', 'no-store');
  res.json({ data: await service.verifyPrescriptionToken(req.params.token) });
}
