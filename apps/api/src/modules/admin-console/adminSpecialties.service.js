import { prisma } from '../../config/database.js';
import { ApiError } from '../../utils/ApiError.js';
import { withTransaction } from '../../utils/transaction.js';
import * as auditRepository from '../audit/audit.repository.js';

/**
 * Admin › Settings › Specialties (requirement 1: "specialty (from an Admin-managed list)").
 * Administrators add, rename (English/Somali) and deactivate specialties. A specialty is never deleted:
 * deactivating hides it from new applications and search filters while existing doctors keep it.
 */

const present = (s, doctors = 0) => ({ id: s.id, nameEn: s.nameEn, nameSo: s.nameSo, description: s.description ?? null, isActive: s.isActive, doctors });

/** GET /api/v1/admin/specialties — all specialties (active first) with their doctor counts. */
export async function listSpecialties() {
  const [rows, counts] = await Promise.all([
    prisma.specialty.findMany({ orderBy: [{ isActive: 'desc' }, { nameEn: 'asc' }] }),
    prisma.doctorProfile.groupBy({ by: ['specialtyId'], _count: { _all: true } }),
  ]);
  const by = new Map(counts.map((c) => [c.specialtyId, c._count._all]));
  return { items: rows.map((s) => present(s, by.get(s.id) ?? 0)) };
}

async function assertUniqueName(tx, nameEn, exceptId = null) {
  const clash = await tx.specialty.findFirst({ where: { nameEn: { equals: nameEn, mode: 'insensitive' }, ...(exceptId ? { NOT: { id: exceptId } } : {}) } });
  if (clash) throw ApiError.conflict('A specialty with this English name already exists', undefined, 'SPECIALTY_EXISTS');
}

/** POST /api/v1/admin/specialties — { nameEn, nameSo, description? }. Audited. */
export async function createSpecialty({ adminUserId, input }) {
  return withTransaction(async (tx) => {
    await assertUniqueName(tx, input.nameEn);
    const s = await tx.specialty.create({ data: { nameEn: input.nameEn, nameSo: input.nameSo, description: input.description ?? null } });
    await auditRepository.createAuditLog(tx, { actorUserId: adminUserId, action: 'CREATE', entityType: 'Specialty', entityId: s.id, newValues: { fields: ['nameEn', 'nameSo'] } });
    return present(s);
  });
}

/** PATCH /api/v1/admin/specialties/:specialtyId — rename or (de)activate. Audited. */
export async function updateSpecialty({ adminUserId, specialtyId, input }) {
  return withTransaction(async (tx) => {
    const current = await tx.specialty.findUnique({ where: { id: specialtyId } });
    if (!current) throw ApiError.notFound('Specialty not found');
    if (input.nameEn) await assertUniqueName(tx, input.nameEn, specialtyId);
    const s = await tx.specialty.update({ where: { id: specialtyId }, data: input });
    await auditRepository.createAuditLog(tx, { actorUserId: adminUserId, action: 'UPDATE', entityType: 'Specialty', entityId: s.id, oldValues: 'isActive' in input ? { status: current.isActive ? 'ACTIVE' : 'INACTIVE' } : undefined, newValues: { fields: Object.keys(input).sort(), ...('isActive' in input ? { status: input.isActive ? 'ACTIVE' : 'INACTIVE' } : {}) } });
    return present(s);
  });
}
