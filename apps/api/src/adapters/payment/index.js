import { createMockWalletProvider } from './mockWalletProvider.js';

/**
 * Payment provider registry. Today every provider is a SIMULATED adapter (no real requests, no real
 * money). A real integration later replaces one entry with an adapter implementing the same interface
 * (see mockWalletProvider.js) — services never import a provider directly.
 */
const PROVIDERS = Object.freeze({
  EVC_PLUS: createMockWalletProvider({ code: 'EVC_PLUS', name: 'EVC Plus', prefix: 'EVC' }),
  ZAAD: createMockWalletProvider({ code: 'ZAAD', name: 'ZAAD', prefix: 'ZAAD' }),
  EDAHAB: createMockWalletProvider({ code: 'EDAHAB', name: 'eDahab', prefix: 'EDH' }),
});

export const PROVIDER_CODES = Object.freeze(Object.keys(PROVIDERS));

export function getPaymentProvider(code) {
  const provider = PROVIDERS[code];
  if (!provider) throw new Error(`Unknown payment provider ${code}`);
  return provider;
}

export const listPaymentProviders = () => PROVIDER_CODES.map((code) => ({ code, name: PROVIDERS[code].name, simulated: PROVIDERS[code].simulated }));
