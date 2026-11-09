import bcrypt from 'bcrypt';
import { getBcryptRounds } from '../config/auth.js';

/**
 * Password hashing with bcrypt (cost from BCRYPT_ROUNDS, default 12, minimum 10).
 * bcrypt only uses the first 72 bytes of input, so validation caps passwords at 72 UTF-8 bytes.
 */
export const MAX_PASSWORD_BYTES = 72;

/** bcrypt hash of a password (cost from BCRYPT_ROUNDS). */
export function hashPassword(password) {
  return bcrypt.hash(password, getBcryptRounds());
}

const isBcryptHash = (hash) => typeof hash === 'string' && /^\$2[aby]\$\d{2}\$/.test(hash);

// A real bcrypt hash of a random value, used to keep login timing constant for unknown accounts.
let dummyHashPromise;
const dummyHash = () => (dummyHashPromise ??= bcrypt.hash(`dummy-${Math.random()}`, getBcryptRounds()));

/** Compares a password with a stored hash. Non-bcrypt hashes (e.g. legacy dev seeds) never match. */
export async function verifyPassword(password, hash) {
  if (!isBcryptHash(hash)) {
    await bcrypt.compare(password, await dummyHash());
    return false;
  }
  return bcrypt.compare(password, hash);
}

/** Spends the same time as a real comparison when the account does not exist. */
export async function burnPasswordCheck(password) {
  await bcrypt.compare(password, await dummyHash());
}
