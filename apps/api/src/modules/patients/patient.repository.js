/** Data access: find patient by id (patientProfile.findUnique: one row by unique key). `client` is the Prisma client or a transaction. */
export const findPatientById = (client, id) => client.patientProfile.findUnique({ where: { id } });
