import { qualifiedSequence } from '../../utils/sql.js';

/** Data access for prescriptions. Token hashes and storage keys are never returned to clients. */

/** Public verification lookup: selects only non-identifying fields (no patient, no items, no consultation). */
export const findForPublicVerification = (client, verificationTokenHash) =>
  client.prescription.findUnique({
    where: { verificationTokenHash },
    select: {
      status: true,
      issuedAt: true,
      cancelledAt: true,
      doctor: { select: { user: { select: { fullName: true } }, specialty: { select: { nameEn: true, nameSo: true } } } },
    },
  });

const ITEMS = { orderBy: [{ position: 'asc' }, { id: 'asc' }] };

/** Everything the doctor/patient detail views and the PDF need (never the token hash). */
export const DETAIL_SELECT = Object.freeze({
  id: true,
  reference: true,
  status: true,
  consultationId: true,
  patientId: true,
  doctorId: true,
  issuedAt: true,
  cancelledAt: true,
  cancellationReason: true,
  replacedAt: true,
  replacementReason: true,
  generalNotes: true,
  replacesPrescriptionId: true,
  pdfFileKey: true,
  pdfSha256: true,
  pdfGeneratedAt: true,
  createdAt: true,
  updatedAt: true,
  items: { ...ITEMS, select: { id: true, medicineName: true, dose: true, frequency: true, duration: true, quantity: true, instructions: true, warnings: true, position: true } },
  replaces: { select: { id: true, reference: true } },
  replacedBy: { select: { id: true, reference: true, status: true } },
  doctor: {
    select: {
      id: true,
      userId: true,
      licenceNumber: true,
      licenceCountry: true,
      verifiedAt: true,
      specialty: { select: { nameEn: true, nameSo: true } },
      user: { select: { fullName: true } },
    },
  },
  patient: { select: { id: true, userId: true, dateOfBirth: true, user: { select: { fullName: true, preferredLanguage: true } } } },
  consultation: { select: { id: true, appointmentId: true, completedAt: true, startedAt: true } },
});

export const findPrescriptionDetail = (client, id) => client.prescription.findUnique({ where: { id }, select: DETAIL_SELECT });

export const findPrescriptionRow = (client, id) => client.prescription.findUnique({ where: { id } });

export const createDraft = (client, { consultationId, patientId, doctorId, generalNotes, items }) =>
  client.prescription.create({
    data: {
      consultationId,
      patientId,
      doctorId,
      status: 'DRAFT',
      issuedAt: null,
      verificationTokenHash: null,
      generalNotes: generalNotes ?? null,
      items: { create: items.map((it, position) => ({ ...it, position })) },
    },
    select: { id: true },
  });

/** Replaces a draft's lines (trigger: only allowed while DRAFT). */
export async function replaceDraftItems(client, prescriptionId, items) {
  await client.prescriptionItem.deleteMany({ where: { prescriptionId } });
  await client.prescriptionItem.createMany({ data: items.map((it, position) => ({ ...it, prescriptionId, position })) });
}

export const updatePrescription = (client, id, data) => client.prescription.update({ where: { id }, data, select: { id: true, status: true } });

export const deleteDraft = async (client, id) => {
  await client.prescriptionItem.deleteMany({ where: { prescriptionId: id } });
  await client.prescription.delete({ where: { id } });
};

export async function nextReferenceNumber(client) {
  const [{ n }] = await client.$queryRawUnsafe(`SELECT nextval('${qualifiedSequence('prescription_reference_seq')}')::int AS n`);
  return n;
}

const LIST_SELECT = Object.freeze({
  id: true,
  reference: true,
  status: true,
  consultationId: true,
  issuedAt: true,
  cancelledAt: true,
  replacedAt: true,
  createdAt: true,
  replaces: { select: { id: true, reference: true } },
  replacedBy: { select: { id: true, reference: true } },
  _count: { select: { items: true } },
  doctor: { select: { id: true, specialty: { select: { nameEn: true, nameSo: true } }, user: { select: { fullName: true } } } },
  patient: { select: { id: true, user: { select: { fullName: true } } } },
  consultation: { select: { appointmentId: true } },
});

export async function listPrescriptions(client, where, { page, pageSize }) {
  const [total, rows] = await Promise.all([
    client.prescription.count({ where }),
    client.prescription.findMany({ where, select: LIST_SELECT, orderBy: [{ issuedAt: { sort: 'desc', nulls: 'first' } }, { createdAt: 'desc' }], skip: (page - 1) * pageSize, take: pageSize }),
  ]);
  return { total, rows };
}

/** Consultation + appointment + both parties, for authorization. */
export const findConsultationForPrescribing = (client, consultationId) =>
  client.consultation.findUnique({
    where: { id: consultationId },
    select: {
      id: true,
      status: true,
      completedAt: true,
      patientId: true,
      doctorId: true,
      appointmentId: true,
      appointment: { select: { id: true, status: true } },
      patient: { select: { userId: true } },
      doctor: { select: { userId: true, verificationStatus: true, accountStatus: true } },
    },
  });

export const listForConsultation = (client, consultationId, { includeDrafts }) =>
  client.prescription.findMany({
    where: { consultationId, ...(includeDrafts ? {} : { status: { not: 'DRAFT' } }) },
    select: LIST_SELECT,
    orderBy: [{ createdAt: 'asc' }],
  });
