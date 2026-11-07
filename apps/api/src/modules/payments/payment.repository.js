/** Data access for payments, payment attempts and doctor earnings. */

export const findAttemptByIdempotencyKey = (client, idempotencyKey) =>
  client.paymentAttempt.findUnique({ where: { idempotencyKey }, include: { payment: true } });

export const findPaymentById = (client, id) => client.payment.findUnique({ where: { id } });

export const findPaymentByAppointmentId = (client, appointmentId) => client.payment.findUnique({ where: { appointmentId } });

export const createPayment = (client, data) => client.payment.create({ data });

export const createPaymentAttempt = (client, data) => client.paymentAttempt.create({ data });

export const createDoctorEarning = (client, data) => client.doctorEarning.create({ data });

export const setDoctorEarningStatus = (client, appointmentId, status) =>
  client.doctorEarning.updateMany({ where: { appointmentId }, data: { status } });

/* ---------------------------------------------------------------- simulated payment flow */

export const updatePayment = (client, id, data) => client.payment.update({ where: { id }, data });

export const updatePaymentAttempt = (client, id, data) => client.paymentAttempt.update({ where: { id }, data });

export const findAttemptsForPayment = (client, paymentId) => client.paymentAttempt.findMany({ where: { paymentId }, orderBy: { attemptNumber: 'asc' } });

/** Closes an unfinished payment of an expiring reservation (no-op if there is none or it already succeeded). */
export async function closeOpenPaymentForAppointment(client, appointmentId, reason) {
  const payment = await client.payment.findUnique({ where: { appointmentId } });
  if (!payment || payment.status === 'SUCCEEDED') return null;
  const open = await client.paymentAttempt.findMany({ where: { paymentId: payment.id, status: 'INITIATED' } });
  for (const attempt of open) {
    await client.paymentAttempt.update({ where: { id: attempt.id }, data: { status: 'FAILED', responseData: { ...(attempt.responseData ?? {}), outcome: 'EXPIRED', message: reason } } });
  }
  return client.payment.update({ where: { id: payment.id }, data: { status: 'CANCELLED' } });
}

const PAYMENT_LIST_INCLUDE = Object.freeze({
  attempts: { orderBy: { attemptNumber: 'asc' } },
  refunds: { orderBy: { createdAt: 'asc' } },
  appointment: {
    select: {
      id: true, startAtUtc: true, endAtUtc: true, status: true, feeAmount: true, currency: true, holdExpiresAt: true, patientId: true,
      doctor: { select: { id: true, specialty: { select: { nameEn: true, nameSo: true } }, user: { select: { fullName: true } } } },
      patient: { select: { id: true, user: { select: { fullName: true } } } },
    },
  },
});

export const findPaymentDetail = (client, id) => client.payment.findUnique({ where: { id }, include: PAYMENT_LIST_INCLUDE });

export const findPaymentDetailByAppointment = (client, appointmentId) => client.payment.findUnique({ where: { appointmentId }, include: PAYMENT_LIST_INCLUDE });

export const listPaymentsForPatient = (client, patientId) =>
  client.payment.findMany({ where: { patientId }, include: PAYMENT_LIST_INCLUDE, orderBy: { createdAt: 'desc' }, take: 100 });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const adminPaymentWhere = ({ status, provider, q, from = null, to = null }) => ({
  ...(status ? { status } : {}),
  ...(provider ? { provider } : {}),
  ...(from ? { createdAt: { gte: from, lt: to } } : {}),
  ...(q
    ? {
        OR: [
          ...(UUID.test(q) ? [{ id: q }, { appointmentId: q }] : []),
          { attempts: { some: { providerReference: { contains: q, mode: 'insensitive' } } } },
          { patient: { user: { fullName: { contains: q, mode: 'insensitive' } } } },
          { appointment: { doctor: { user: { fullName: { contains: q, mode: 'insensitive' } } } } },
        ],
      }
    : {}),
});

export const listPaymentsForAdmin = (client, filters, { skip, take }) =>
  client.payment.findMany({ where: adminPaymentWhere(filters), include: PAYMENT_LIST_INCLUDE, orderBy: { createdAt: 'desc' }, skip, take });

export const countPaymentsForAdmin = (client, filters) => client.payment.count({ where: adminPaymentWhere(filters) });

export const sumPayments = (client, where) => client.payment.aggregate({ where, _sum: { amount: true }, _count: { _all: true } });

export const countPayments = (client, where) => client.payment.count({ where });

export const countAttempts = (client, where) => client.paymentAttempt.count({ where });
