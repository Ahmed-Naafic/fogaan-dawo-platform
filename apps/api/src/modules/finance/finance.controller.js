import { ApiError } from '../../utils/ApiError.js';
import * as admin from '../payments/financeAdmin.service.js';
import { resolveRange } from './finance.dates.js';
import * as finance from './finance.service.js';

/** Thin controllers for admin finance. The administrator is always the signed-in ADMIN user. */

/** Lists filter by date only when a preset is given (no preset = all dates, as before). */
function optionalRange(query) {
  if (!query.preset || query.preset === 'all') return null;
  try {
    return resolveRange(query);
  } catch (error) {
    throw ApiError.badRequest(error.message, [{ path: 'range', message: error.message }], finance.FinanceErrorCode.RANGE_INVALID);
  }
}

export const overview = async (req, res) => res.json({ data: await finance.overview(req.validatedQuery) });
export const listPayments = async (req, res) => res.json({ data: await admin.listPayments({ ...req.validatedQuery, range: optionalRange(req.validatedQuery) }) });
export const listRefunds = async (req, res) => res.json({ data: await admin.listRefunds({ ...req.validatedQuery, range: optionalRange(req.validatedQuery) }) });
export const getRefund = async (req, res) => res.json({ data: await finance.getRefund(req.params.refundId) });
export const rejectRefund = async (req, res) => res.json({ data: await finance.rejectRefund({ refundId: req.params.refundId, adminUserId: req.auth.user.id, reason: req.body.reason }) });
export const doctorEarnings = async (req, res) => res.json({ data: await finance.doctorEarnings(req.validatedQuery) });
export const report = async (req, res) => res.json({ data: await finance.report(req.validatedQuery) });
export const getSettings = async (_req, res) => res.json({ data: await finance.getSettings() });
export const updateCommission = async (req, res) => res.json({ data: await finance.updateCommission({ adminUserId: req.auth.user.id, percent: req.body.percent }) });

/** CSV download. Admin-only like every route here; contains no credentials or contact details. */
export const exportCsv = async (req, res) => {
  const { filename, body } = await finance.exportCsv(req.validatedQuery);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(body);
};
