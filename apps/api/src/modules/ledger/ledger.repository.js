/** Append-only writes and reads for financial_transactions. Always call inside a transaction. */

/** Data access: post entry (financialTransaction.create: inserts a row). `client` is the Prisma client or a transaction. */
export function postEntry(tx, { type, amount, currency, reference, paymentId = null, refundId = null, metadata }) {
  return tx.financialTransaction.create({
    data: { type, status: 'POSTED', amount, currency, reference, paymentId, refundId, metadata },
  });
}

/** Data access: find entries for payment (financialTransaction.findMany: matching rows). `client` is the Prisma client or a transaction. */
export function findEntriesForPayment(client, paymentId) {
  return client.financialTransaction.findMany({
    where: { OR: [{ paymentId }, { refund: { paymentId } }] },
    orderBy: { createdAt: 'asc' },
  });
}
