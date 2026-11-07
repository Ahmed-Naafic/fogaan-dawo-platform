import { z } from 'zod';

export const userIdParamsSchema = z.object({ userId: z.uuid({ message: 'userId must be a UUID' }) }).strict();

/**
 * Only ADMIN is granted through this endpoint. PATIENT comes from registration and DOCTOR from the
 * doctor-registration/verification flow, because both require a profile.
 */
export const assignRoleSchema = z.object({ role: z.literal('ADMIN', { message: 'Only the ADMIN role can be assigned here' }) }).strict();
