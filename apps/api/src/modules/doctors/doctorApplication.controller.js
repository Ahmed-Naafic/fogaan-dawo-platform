import * as applicationService from './doctorApplication.service.js';
import { sendPrivateDocument } from './doctorDocument.response.js';

/** Thin controllers for the applicant's own doctor application. */

export async function listSpecialties(_req, res) {
  res.json({ data: await applicationService.listSpecialties() });
}

export async function getMine(req, res) {
  res.json({ data: await applicationService.getMyApplication(req.auth) });
}

export async function saveMine(req, res) {
  res.json({ data: await applicationService.saveMyApplication(req.auth, req.body) });
}

export async function uploadDocument(req, res) {
  const document = await applicationService.uploadMyDocument(req.auth, {
    documentType: req.params.documentType,
    buffer: req.body,
    fileName: String(req.get('x-file-name') ?? '').slice(0, 300),
  });
  res.status(201).json({ data: document });
}

export async function downloadMine(req, res) {
  sendPrivateDocument(res, await applicationService.getMyDocumentFile(req.auth, req.params.documentId));
}

export async function initiateUpload(req, res) {
  res.status(201).json({ data: await applicationService.initiateMyDocumentUpload(req.auth, req.params.documentType, req.body) });
}

export async function finalizeUpload(req, res) {
  res.status(201).json({ data: await applicationService.finalizeMyDocumentUpload(req.auth, req.params.documentType, req.body.uploadToken) });
}

export async function documentUrl(req, res) {
  res.set('Cache-Control', 'private, no-store');
  res.json({ data: await applicationService.getMyDocumentUrl(req.auth, req.params.documentId) });
}

export async function submitMine(req, res) {
  res.json({ data: await applicationService.submitMyApplication(req.auth) });
}
