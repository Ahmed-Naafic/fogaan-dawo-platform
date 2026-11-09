import * as service from './doctorWorkspace.service.js';

/** Thin controllers for the doctor's own workspace (DOCTOR role; permissions enforced by the router). */

/** GET /api/v1/doctors/me/patients — list patients. Thin HTTP adapter: validated input in, service result out as JSON. */
export async function listPatients(req, res) {
  res.set('Cache-Control', 'private, no-store');
  res.json({ data: await service.listMyPatients(req.auth, req.validatedQuery) });
}

/** GET /api/v1/doctors/me/patients/:patientId — get patient. Thin HTTP adapter: validated input in, service result out as JSON. */
export async function getPatient(req, res) {
  res.set('Cache-Control', 'private, no-store');
  res.json({ data: await service.getMyPatient(req.auth, { patientId: req.params.patientId }) });
}

/** GET /api/v1/doctors/me/earnings — earnings. Thin HTTP adapter: validated input in, service result out as JSON. */
export async function earnings(req, res) {
  res.set('Cache-Control', 'private, no-store');
  res.json({ data: await service.myEarnings(req.auth, req.validatedQuery) });
}
