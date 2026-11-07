import { randomBytes } from 'node:crypto';

/**
 * SIMULATED mobile-money provider. It never makes a network request and never moves money.
 *
 * Every provider adapter (mock today, real later) implements the same interface:
 *   code, name, simulated
 *   validateWallet(msisdn)                       → null | 'WALLET_INVALID'
 *   charge({ amount, currency, msisdn, reference }) → { outcome: 'SUCCESS' | 'FAILED' | 'PENDING', providerReference, message }
 *   checkStatus({ msisdn, providerReference, checks }) → { outcome: 'SUCCESS' | 'FAILED' | 'PENDING', message }
 *   refund({ amount, currency, msisdn, providerReference }) → { outcome: 'SUCCESS' | 'FAILED', providerReference, message }
 *
 * The outcome is decided HERE, on the server, from documented demo wallet numbers (like a provider's
 * sandbox test numbers) — never from anything the browser claims. Last four digits of the wallet:
 *   …0001 → payment FAILED (insufficient balance)
 *   …0002 → payment PENDING (the customer never approves; the reservation then expires)
 *   …0003 → payment PENDING, approved on the next status check (SUCCESS)
 *   …0004 → payment SUCCESS, but a later refund FAILS
 *   anything else → SUCCESS
 */
export const DEMO_WALLET_RULES = Object.freeze({ fail: '0001', pendingForever: '0002', pendingThenSuccess: '0003', refundFails: '0004' });

const SOMALI_MOBILE = /^\+2526\d{7,8}$|^\+2527\d{7,8}$|^\+2529\d{7,8}$/;

const reference = (prefix) => `${prefix}-DEMO-${Date.now().toString(36).toUpperCase()}-${randomBytes(4).toString('hex').toUpperCase()}`;
const suffix = (msisdn) => String(msisdn).slice(-4);

export function createMockWalletProvider({ code, name, prefix }) {
  return Object.freeze({
    code,
    name,
    simulated: true,

    validateWallet(msisdn) {
      return SOMALI_MOBILE.test(String(msisdn ?? '')) ? null : 'WALLET_INVALID';
    },

    async charge({ msisdn }) {
      const providerReference = reference(prefix);
      switch (suffix(msisdn)) {
        case DEMO_WALLET_RULES.fail:
          return { outcome: 'FAILED', providerReference, message: 'Insufficient wallet balance (simulated)' };
        case DEMO_WALLET_RULES.pendingForever:
        case DEMO_WALLET_RULES.pendingThenSuccess:
          return { outcome: 'PENDING', providerReference, message: 'Waiting for the customer to approve on their phone (simulated)' };
        default:
          return { outcome: 'SUCCESS', providerReference, message: 'Payment approved (simulated)' };
      }
    },

    async checkStatus({ msisdn }) {
      if (suffix(msisdn) === DEMO_WALLET_RULES.pendingThenSuccess) return { outcome: 'SUCCESS', message: 'Customer approved the payment (simulated)' };
      if (suffix(msisdn) === DEMO_WALLET_RULES.pendingForever) return { outcome: 'PENDING', message: 'Still waiting for approval (simulated)' };
      return { outcome: 'PENDING', message: 'No final answer yet (simulated)' };
    },

    async refund({ msisdn }) {
      const providerReference = reference(`${prefix}R`);
      if (suffix(msisdn) === DEMO_WALLET_RULES.refundFails) return { outcome: 'FAILED', providerReference, message: 'Refund rejected by the wallet provider (simulated)' };
      return { outcome: 'SUCCESS', providerReference, message: 'Refund sent (simulated — no real money moved)' };
    },
  });
}
