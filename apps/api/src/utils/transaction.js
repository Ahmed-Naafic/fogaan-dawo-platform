import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';
import { ApiError } from './ApiError.js';
import { qualifiedTable } from './sql.js';

/**
 * Runs `fn(tx)` in one interactive database transaction.
 * Booking, payment, refund and ledger operations must go through this helper so that
 * row locks (see lockRow) and every write either commit together or not at all.
 * Neon adds network latency, so the timeout is generous.
 */
export function withTransaction(fn, { client = prisma, timeout = 20_000, isolationLevel } = {}) {
  return client.$transaction(fn, {
    maxWait: 10_000,
    timeout,
    ...(isolationLevel ? { isolationLevel } : {}),
  });
}

/**
 * SELECT ... FOR UPDATE on one row inside a transaction. Returns true if the row exists.
 * The table is schema-qualified from an allow-list (identifiers cannot be bound); the id is bound.
 */
export async function lockRow(tx, table, id) {
  const rows = await tx.$queryRawUnsafe(`SELECT id FROM ${qualifiedTable(table)} WHERE id = $1::uuid FOR UPDATE`, id);
  return rows.length === 1;
}

/** Maps unique-constraint violations (e.g. appointments_one_active_per_slot) to a 409. */
export function rethrowConflict(error, message) {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    throw new ApiError(409, message, { constraint: error.meta?.target });
  }
  throw error;
}
