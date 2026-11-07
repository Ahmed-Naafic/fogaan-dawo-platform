import { ApiError } from '../../utils/ApiError.js';
import { toDecimal } from '../../utils/money.js';
import * as settingRepository from './setting.repository.js';

export const SettingKey = Object.freeze({
  commissionRate: 'commission_rate', // value: { "rate": "0.1500" } — fraction of the consultation fee
});

/** Reads the platform commission rate (fraction 0–1). There is deliberately no hard-coded fallback. */
export async function getCommissionRate(client) {
  const setting = await settingRepository.findSettingByKey(client, SettingKey.commissionRate);
  const rate = setting?.value?.rate;
  if (rate == null) throw new ApiError(500, 'Platform setting "commission_rate" is not configured');
  const decimal = toDecimal(rate);
  if (decimal.isNegative() || decimal.greaterThan(1)) throw new ApiError(500, 'commission_rate must be in [0, 1]');
  return decimal;
}
