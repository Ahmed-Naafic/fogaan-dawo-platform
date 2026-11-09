import * as appointments from './adminAppointments.service.js';
import * as audit from './adminAudit.service.js';
import * as patients from './adminPatients.service.js';
import * as reports from './adminReports.service.js';
import * as settings from './adminSettings.service.js';

/** Thin controllers for the admin console (ADMIN role; permissions enforced by each router). */

/** GET /api/v1/admin/patients — list patients. Thin HTTP adapter: validated input in, service result out as JSON. */
export const listPatients = async (req, res) => res.json({ data: await patients.listPatients(req.validatedQuery) });
/** GET /api/v1/admin/patients/:patientId — get patient. Thin HTTP adapter: validated input in, service result out as JSON. */
export const getPatient = async (req, res) => res.json({ data: await patients.getPatient(req.params.patientId) });
/** POST /api/v1/admin/patients/:patientId/suspend — suspend patient. Thin HTTP adapter: validated input in, service result out as JSON. */
export const suspendPatient = async (req, res) =>
  res.json({ data: { ...(await patients.suspendPatient({ patientId: req.params.patientId, adminUserId: req.auth.user.id, reason: req.body.reason })), patient: (await patients.getPatient(req.params.patientId)).patient } });
/** POST /api/v1/admin/patients/:patientId/reactivate — reactivate patient. Thin HTTP adapter: validated input in, service result out as JSON. */
export const reactivatePatient = async (req, res) =>
  res.json({ data: { ...(await patients.reactivatePatient({ patientId: req.params.patientId, adminUserId: req.auth.user.id, reason: req.body.reason ?? null })), patient: (await patients.getPatient(req.params.patientId)).patient } });

/** GET /api/v1/admin/appointments — list appointments. Thin HTTP adapter: validated input in, service result out as JSON. */
export const listAppointments = async (req, res) => res.json({ data: await appointments.listAppointments(req.validatedQuery) });
/** GET /api/v1/admin/appointments/:appointmentId — get appointment. Thin HTTP adapter: validated input in, service result out as JSON. */
export const getAppointment = async (req, res) => res.json({ data: await appointments.getAppointment(req.params.appointmentId) });

/** GET /api/v1/admin/reports/overview — report overview. Thin HTTP adapter: validated input in, service result out as JSON. */
export const reportOverview = async (req, res) => res.json({ data: await reports.overview(req.validatedQuery) });
/** GET /api/v1/admin/reports/export — report export. Thin HTTP adapter: validated input in, service result out as JSON. */
export async function reportExport(req, res) {
  const { filename, body } = await reports.exportCsv(req.validatedQuery);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(body);
}

/** GET /api/v1/admin/audit-logs — list audit logs. Thin HTTP adapter: validated input in, service result out as JSON. */
export const listAuditLogs = async (req, res) => res.json({ data: await audit.listAuditLogs(req.validatedQuery) });

/** GET /api/v1/admin/settings — get settings. Thin HTTP adapter: validated input in, service result out as JSON. */
export const getSettings = async (_req, res) => res.json({ data: await settings.getSettings() });
/** PUT /api/v1/admin/settings/booking-policy — update booking policy. Thin HTTP adapter: validated input in, service result out as JSON. */
export const updateBookingPolicy = async (req, res) => {
  const { confirm: _confirm, ...values } = req.body;
  res.json({ data: await settings.updateBookingPolicy({ adminUserId: req.auth.user.id, values }) });
};
