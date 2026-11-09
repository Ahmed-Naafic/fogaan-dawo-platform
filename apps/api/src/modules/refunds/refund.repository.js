/** Data access for refunds. */

/** Data access: find refunds for payment (refund.findMany: matching rows). `client` is the Prisma client or a transaction. */
export const findRefundsForPayment = (client, paymentId) => client.refund.findMany({ where: { paymentId } });

/** Data access: find refund by id (refund.findUnique: one row by unique key). `client` is the Prisma client or a transaction. */
export const findRefundById = (client, id) => client.refund.findUnique({ where: { id } });

/** Data access: create refund (refund.create: inserts a row). `client` is the Prisma client or a transaction. */
export const createRefund = (client, data) => client.refund.create({ data });

/** Data access: update refund (refund.update: updates a row). `client` is the Prisma client or a transaction. */
export const updateRefund = (client, id, data) => client.refund.update({ where: { id }, data });

/** Data access: find refunds by status (refund.findMany: matching rows). `client` is the Prisma client or a transaction. */
export const findRefundsByStatus = (client, status) =>
  client.refund.findMany({
    where: { status },
    orderBy: { createdAt: 'desc' },
    include: { payment: { select: { provider: true, amount: true } } },
  });

/* ---------------------------------------------------------------- admin finance */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const adminRefundWhere = ({ status, q, from = null, to = null }) => ({
  ...(status ? { status } : {}),
  ...(from ? { createdAt: { gte: from, lt: to } } : {}),
  ...(q
    ? {
        OR: [
          ...(UUID.test(q) ? [{ id: q }, { paymentId: q }, { appointmentId: q }] : []),
          { providerReference: { contains: q, mode: 'insensitive' } },
          { payment: { patient: { user: { fullName: { contains: q, mode: 'insensitive' } } } } },
          { appointment: { doctor: { user: { fullName: { contains: q, mode: 'insensitive' } } } } },
        ],
      }
    : {}),
});

const ADMIN_REFUND_INCLUDE = {
  reviewer: { select: { fullName: true } },
  payment: { select: { provider: true, amount: true, patient: { select: { user: { select: { fullName: true } } } } } },
  appointment: { select: { id: true, startAtUtc: true, doctor: { select: { user: { select: { fullName: true } } } } } },
};

/** Data access: list refunds for admin (refund.findMany: matching rows). `client` is the Prisma client or a transaction. */
export const listRefundsForAdmin = (client, filters, { skip, take }) =>
  client.refund.findMany({ where: adminRefundWhere(filters), include: ADMIN_REFUND_INCLUDE, orderBy: { createdAt: 'desc' }, skip, take });

/** Data access: count refunds for admin (refund.count: count of matching rows). `client` is the Prisma client or a transaction. */
export const countRefundsForAdmin = (client, filters) => client.refund.count({ where: adminRefundWhere(filters) });

/** Data access: sum refunds (refund.aggregate: aggregate values). `client` is the Prisma client or a transaction. */
export const sumRefunds = (client, where) => client.refund.aggregate({ where, _sum: { amount: true }, _count: { _all: true } });
