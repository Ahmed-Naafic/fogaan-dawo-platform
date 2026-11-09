import { prisma } from '../../config/database.js';

/**
 * Administrator monitoring of prescriptions and medical documents — METADATA ONLY.
 * Every query uses an explicit select that never includes: medicine names, doses, instructions, warnings,
 * general notes, cancellation/replacement reasons, diagnoses or note text, document file names,
 * descriptions, storage keys, checksums or file contents. There is no admin route to any file.
 */
export const RECORD_AUDIT_ENTITIES = Object.freeze(['Prescription', 'MedicalDocument', 'PatientMedicalHistoryAccess', 'SecurityEvent']);

const shortRef = (id) => id.slice(0, 8).toUpperCase();

/** Admin › Medical records overview: counts of prescriptions, documents and clinical audit events (metadata only, no clinical content). */
export async function overview({ from = null } = {}) {
  const since = from ?? new Date(Date.now() - 30 * 86_400_000);
  const [byStatus, issued30, docs, archived, bytes, byCategory, byType] = await Promise.all([
    prisma.prescription.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.prescription.count({ where: { issuedAt: { gte: since } } }),
    prisma.consultationAttachment.count(),
    prisma.consultationAttachment.count({ where: { archivedAt: { not: null } } }),
    prisma.consultationAttachment.aggregate({ _sum: { fileSize: true } }),
    prisma.consultationAttachment.groupBy({ by: ['category'], _count: { _all: true } }),
    prisma.consultationAttachment.groupBy({ by: ['mimeType'], _count: { _all: true }, _sum: { fileSize: true } }),
  ]);
  const counts = Object.fromEntries(['DRAFT', 'VALID', 'CANCELLED', 'REPLACED'].map((s) => [s, byStatus.find((r) => r.status === s)?._count._all ?? 0]));
  return {
    prescriptions: { ...counts, issued: counts.VALID + counts.CANCELLED + counts.REPLACED, issuedLast30Days: issued30 },
    documents: {
      total: docs,
      active: docs - archived,
      archived,
      storageBytes: bytes._sum.fileSize ?? 0,
      byCategory: Object.fromEntries(byCategory.map((r) => [r.category, r._count._all])),
      byType: byType.map((r) => ({ mimeType: r.mimeType, count: r._count._all, bytes: r._sum.fileSize ?? 0 })),
    },
  };
}

/** Admin › Medical records: prescriptions as metadata (reference, status, doctor, dates) with filters and paging. Never medicines or diagnoses. */
export async function listPrescriptions({ status, q, page, pageSize }) {
  const where = {
    status: status ? status : { not: 'DRAFT' },
    ...(q ? { OR: [{ reference: { contains: q, mode: 'insensitive' } }, { doctor: { user: { fullName: { contains: q, mode: 'insensitive' } } } }] } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.prescription.count({ where }),
    prisma.prescription.findMany({
      where,
      orderBy: [{ issuedAt: { sort: 'desc', nulls: 'last' } }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        reference: true,
        status: true,
        issuedAt: true,
        cancelledAt: true,
        replacedAt: true,
        consultationId: true,
        patientId: true,
        doctor: { select: { id: true, user: { select: { fullName: true } } } },
        replaces: { select: { reference: true } },
        replacedBy: { select: { reference: true } },
        _count: { select: { items: true } },
      },
    }),
  ]);
  return {
    total,
    page,
    pageSize,
    items: rows.map((r) => ({
      id: r.id,
      reference: r.reference,
      status: r.status,
      issuedAt: r.issuedAt?.toISOString() ?? null,
      cancelledAt: r.cancelledAt?.toISOString() ?? null,
      replacedAt: r.replacedAt?.toISOString() ?? null,
      replaces: r.replaces?.reference ?? null,
      replacedBy: r.replacedBy?.reference ?? null,
      itemCount: r._count.items,
      doctor: { id: r.doctor.id, name: r.doctor.user.fullName },
      patientRef: shortRef(r.patientId), // a reference, not the patient's identity
      consultationRef: shortRef(r.consultationId),
    })),
  };
}

/** Admin › Medical records: medical documents as metadata (category, size, uploader, dates). Never the files. */
export async function listDocuments({ category, archived, page, pageSize }) {
  const where = { ...(category ? { category } : {}), ...(archived === 'true' ? { archivedAt: { not: null } } : archived === 'false' ? { archivedAt: null } : {}) };
  const [total, rows] = await Promise.all([
    prisma.consultationAttachment.count({ where }),
    prisma.consultationAttachment.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        category: true,
        mimeType: true,
        fileSize: true,
        createdAt: true,
        archivedAt: true,
        uploadedByUserId: true,
        consultationId: true,
        consultation: { select: { patientId: true, patient: { select: { userId: true } }, doctor: { select: { id: true, user: { select: { fullName: true } } } } } },
      },
    }),
  ]);
  return {
    total,
    page,
    pageSize,
    items: rows.map((d) => ({
      id: d.id,
      category: d.category,
      mimeType: d.mimeType,
      fileSize: d.fileSize,
      uploadedAt: d.createdAt.toISOString(),
      archivedAt: d.archivedAt?.toISOString() ?? null,
      uploadedBy: d.uploadedByUserId === d.consultation.patient.userId ? 'PATIENT' : 'DOCTOR',
      doctor: { id: d.consultation.doctor.id, name: d.consultation.doctor.user.fullName },
      patientRef: shortRef(d.consultation.patientId),
      consultationRef: shortRef(d.consultationId),
    })),
  };
}

/** Audit values written by these modules never contain clinical text; still, only whitelisted keys are returned. */
const SAFE_AUDIT_KEYS = ['action', 'status', 'reference', 'itemCount', 'category', 'mimeType', 'bytes', 'uploadedBy', 'archived', 'by', 'event', 'appointmentStatus', 'emergencyContactShown', 'entryCount', 'replacementReference', 'pdfBytes'];
function actorView(actor) {
  const roles = actor.roles.map((r) => r.role.name);
  const professional = Boolean(actor.doctorProfile) || roles.includes('ADMIN');
  return { ref: shortRef(actor.id), role: roles.includes('ADMIN') ? 'ADMIN' : actor.doctorProfile ? 'DOCTOR' : 'PATIENT', name: professional ? actor.fullName : null };
}

const pickSafe = (v) => (v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([k]) => SAFE_AUDIT_KEYS.includes(k))) : null);

/** Admin › Medical records: clinical audit trail (who opened or changed which record, when). */
export async function listAudit({ entityType, page, pageSize }) {
  const where = { entityType: entityType ? entityType : { in: RECORD_AUDIT_ENTITIES } };
  const [total, rows] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        oldValues: true,
        newValues: true,
        createdAt: true,
        actor: { select: { id: true, fullName: true, doctorProfile: { select: { id: true } }, roles: { select: { role: { select: { name: true } } } } } },
      },
    }),
  ]);
  return {
    total,
    page,
    pageSize,
    items: rows.map((r) => ({
      id: r.id,
      at: r.createdAt.toISOString(),
      action: r.action,
      entityType: r.entityType,
      entityRef: r.entityId ? shortRef(r.entityId) : null,
      // Doctors and administrators are named; patients appear only as a reference (never their identity).
      actor: r.actor ? actorView(r.actor) : null,
      before: pickSafe(r.oldValues),
      after: pickSafe(r.newValues),
    })),
  };
}
