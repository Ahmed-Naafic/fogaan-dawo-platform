import * as doctorAdminService from './doctorAdmin.service.js';

/** Thin controllers for /api/v1/admin/doctors (ADMIN + doctors:manage, enforced by the router). */

export async function list(req, res) {
  res.json({ data: await doctorAdminService.listDoctors(req.validatedQuery) });
}

export async function suspend(req, res) {
  res.json({ data: await doctorAdminService.suspend({ doctorId: req.params.doctorId, adminUserId: req.auth.user.id, reason: req.body.reason }) });
}
