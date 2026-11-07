import * as summaryService from '../consultations/consultationSummary.service.js';
import * as service from './prescription.service.js';

/** Thin controllers: the actor is always req.auth; ids only from validated params. */

export async function createDraft(req, res) {
  res.status(201).json({ data: await service.createDraft(req.auth, req.params.consultationId, req.body) });
}
export async function listForConsultation(req, res) {
  res.json({ data: await service.listForConsultation(req.auth, req.params.consultationId) });
}
export async function get(req, res) {
  res.set('Cache-Control', 'private, no-store');
  res.json({ data: await service.getPrescription(req.auth, req.params.prescriptionId) });
}
export async function updateDraft(req, res) {
  res.json({ data: await service.updateDraft(req.auth, req.params.prescriptionId, req.body) });
}
export async function discardDraft(req, res) {
  res.json({ data: await service.discardDraft(req.auth, req.params.prescriptionId) });
}
export async function issue(req, res) {
  res.json({ data: await service.issueDraft(req.auth, req.params.prescriptionId) });
}
export async function replace(req, res) {
  res.status(201).json({ data: await service.replacePrescription(req.auth, req.params.prescriptionId, req.body) });
}
export async function cancel(req, res) {
  res.json({ data: await service.cancelPrescription(req.auth, req.params.prescriptionId, req.body) });
}
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
export async function listMine(req, res) {
  res.json({ data: await service.listMine(req.auth, req.validatedQuery) });
}
export async function listForDoctor(req, res) {
  res.json({ data: await service.listForDoctor(req.auth, req.validatedQuery) });
}
export async function summary(req, res) {
  res.set('Cache-Control', 'private, no-store');
  res.json({ data: await summaryService.getConsultationSummary(req.auth, req.params.consultationId) });
}
export async function listMySummaries(req, res) {
  res.set('Cache-Control', 'private, no-store');
  res.json({ data: await summaryService.listMySummaries(req.auth) });
}
/** Public: limited verification info only (see verifyPrescriptionToken). */
export async function verify(req, res) {
  res.set('Cache-Control', 'no-store');
  res.json({ data: await service.verifyPrescriptionToken(req.params.token) });
}
