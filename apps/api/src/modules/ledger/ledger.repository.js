/** Append-only writes and reads for financial_transactions. Always call inside a transaction. */

export function postEntry(tx, { type, amount, currency, reference, paymentId = null, refundId = null, metadata }) {
  return tx.financialTransaction.create({
    data: { type, status: 'POSTED', amount, currency, reference, paymentId, refundId, metadata },
  });
}

export function findEntriesForPayment(client, paymentId) {
  return client.financialTransaction.findMany({
    where: { OR: [{ paymentId }, { refund: { paymentId } }] },
    orderBy: { createdAt: 'asc' },
  });
}
