import * as doctorAdminService from './doctorAdmin.service.js';

/** Thin controllers for /api/v1/admin/doctors (ADMIN + doctors:manage, enforced by the router). */

/** GET /api/v1/admin/doctor-applications, GET /api/v1/admin/doctors — list. Thin HTTP adapter: validated input in, service result out as JSON. */
export async function list(req, res) {
  res.json({ data: await doctorAdminService.listDoctors(req.validatedQuery) });
}

/** PATCH /api/v1/admin/doctors/:doctorId — update. Thin HTTP adapter: validated input in, service result out as JSON. */
export async function update(req, res) {
  res.json({ data: await doctorAdminService.updateDoctor({ doctorId: req.params.doctorId, adminUserId: req.auth.user.id, input: req.body }) });
}

/** POST /api/v1/admin/doctors/:doctorId/suspend — suspend. Thin HTTP adapter: validated input in, service result out as JSON. */
export async function suspend(req, res) {
  res.json({ data: await doctorAdminService.suspend({ doctorId: req.params.doctorId, adminUserId: req.auth.user.id, reason: req.body.reason }) });
}
