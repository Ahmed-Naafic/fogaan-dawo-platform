export const findPatientById = (client, id) => client.patientProfile.findUnique({ where: { id } });
