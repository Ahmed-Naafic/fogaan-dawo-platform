import * as service from './doctorWorkspace.service.js';

/** Thin controllers for the doctor's own workspace (DOCTOR role; permissions enforced by the router). */

export async function listPatients(req, res) {
  res.set('Cache-Control', 'private, no-store');
  res.json({ data: await service.listMyPatients(req.auth, req.validatedQuery) });
}

export async function getPatient(req, res) {
  res.set('Cache-Control', 'private, no-store');
  res.json({ data: await service.getMyPatient(req.auth, { patientId: req.params.patientId }) });
}

export async function earnings(req, res) {
  res.set('Cache-Control', 'private, no-store');
  res.json({ data: await service.myEarnings(req.auth, req.validatedQuery) });
}
