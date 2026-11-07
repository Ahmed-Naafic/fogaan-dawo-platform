import * as appointments from './adminAppointments.service.js';
import * as audit from './adminAudit.service.js';
import * as patients from './adminPatients.service.js';
import * as reports from './adminReports.service.js';
import * as settings from './adminSettings.service.js';

/** Thin controllers for the admin console (ADMIN role; permissions enforced by each router). */

export const listPatients = async (req, res) => res.json({ data: await patients.listPatients(req.validatedQuery) });
export const getPatient = async (req, res) => res.json({ data: await patients.getPatient(req.params.patientId) });
export const suspendPatient = async (req, res) =>
  res.json({ data: { ...(await patients.suspendPatient({ patientId: req.params.patientId, adminUserId: req.auth.user.id, reason: req.body.reason })), patient: (await patients.getPatient(req.params.patientId)).patient } });
export const reactivatePatient = async (req, res) =>
  res.json({ data: { ...(await patients.reactivatePatient({ patientId: req.params.patientId, adminUserId: req.auth.user.id, reason: req.body.reason ?? null })), patient: (await patients.getPatient(req.params.patientId)).patient } });

export const listAppointments = async (req, res) => res.json({ data: await appointments.listAppointments(req.validatedQuery) });
export const getAppointment = async (req, res) => res.json({ data: await appointments.getAppointment(req.params.appointmentId) });

export const reportOverview = async (req, res) => res.json({ data: await reports.overview(req.validatedQuery) });
export async function reportExport(req, res) {
  const { filename, body } = await reports.exportCsv(req.validatedQuery);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(body);
}

export const listAuditLogs = async (req, res) => res.json({ data: await audit.listAuditLogs(req.validatedQuery) });

export const getSettings = async (_req, res) => res.json({ data: await settings.getSettings() });
export const updateBookingPolicy = async (req, res) => {
  const { confirm: _confirm, ...values } = req.body;
  res.json({ data: await settings.updateBookingPolicy({ adminUserId: req.auth.user.id, values }) });
};
