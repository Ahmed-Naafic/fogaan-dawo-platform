import { ApiError } from '../../utils/ApiError.js';
import { resolveRange } from '../finance/finance.dates.js';
import { FinanceErrorCode } from '../finance/finance.service.js';

/** The finance date-range rules (presets, custom inclusive days, viewer's zone) with a per-screen default. */
export function resolveAdminRange(query, defaultPreset = '30d') {
  try {
    return resolveRange({ ...query, preset: query.preset ?? defaultPreset });
  } catch (error) {
    throw ApiError.badRequest(error.message, [{ path: 'range', message: error.message }], FinanceErrorCode.RANGE_INVALID);
  }
}
