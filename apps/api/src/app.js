import cookieParser from 'cookie-parser';
import express from 'express';
import { env } from './config/env.js';
import { cors } from './middleware/cors.js';
import { errorHandler } from './middleware/errorHandler.js';
import { notFound } from './middleware/notFound.js';
import { createAuthRouter } from './modules/auth/auth.routes.js';
import {
  createAdminDoctorApplicationRouter,
  createAdminDoctorRouter,
  createDoctorApplicationRouter,
  createDoctorRouter,
  createSpecialtyRouter,
} from './modules/doctors/doctor.routes.js';
import { createPatientAppointmentRouter } from './modules/appointments/appointment.routes.js';
import { createConsultationRouter } from './modules/consultations/consultation.routes.js';
import healthRoutes from './modules/health/health.routes.js';
import { createPublicStatsRouter } from './modules/dashboard/dashboard.routes.js';
import { createNotificationRouter } from './modules/notifications/notification.routes.js';
import { createAdminFinanceRouter, createPatientPaymentRouter } from './modules/payments/payment.routes.js';
import { createAdminUserRouter } from './modules/users/user.routes.js';
import { createMeRouter } from './modules/profiles/profile.routes.js';
import { createPrescriptionRouter, createPublicPrescriptionRouter } from './modules/prescriptions/prescription.routes.js';
import { createMedicalDocumentRouter } from './modules/medical-documents/medicalDocument.routes.js';
import { createAdminRecordsRouter } from './modules/admin-records/adminRecords.routes.js';
import { createMessagingRouter } from './modules/messaging/messaging.routes.js';
import { createAdminAppointmentRouter, createAdminAuditRouter, createAdminPatientRouter, createAdminReportRouter, createAdminSettingsRouter, createAdminSmsRouter, createAdminSpecialtyRouter } from './modules/admin-console/adminConsole.routes.js';
import { createLocalStorageRouter } from './modules/storage/storage.routes.js';
import { createJobsRouter } from './modules/jobs/jobs.routes.js';
import { SIGNAL_PATH } from './modules/consultations/consultation.signaling.js';
import { ApiError } from './utils/ApiError.js';

/**
 * Builds the Express app without listening, so tests can mount it on an ephemeral port.
 * Request flow: routes → middleware → controllers → services → repositories → Prisma.
 * Options (tests): { corsOrigins, authRateLimit: { limit, windowMs } }.
 * `signalingAvailable: false` (serverless entry): the WebSocket signaling hub is not running in this
 * process, so its path answers 503 SIGNALING_UNAVAILABLE instead of a misleading 404.
 */
export function createApp({ corsOrigins, authRateLimit, signalingAvailable = true } = {}) {
  const app = express();

  app.disable('x-powered-by');
  if (env.trustProxy > 0) app.set('trust proxy', env.trustProxy);
  app.use(cors(corsOrigins));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.use('/api/health', healthRoutes);
  app.use('/api/internal/jobs', createJobsRouter());
  if (!signalingAvailable) {
    app.all(SIGNAL_PATH, (_req, _res, next) =>
      next(new ApiError(503, 'Video signaling is not available on this deployment', undefined, 'SIGNALING_UNAVAILABLE')),
    );
  }
  app.use('/api/v1/auth', createAuthRouter({ rateLimit: authRateLimit }));
  app.use('/api/v1/admin/users', createAdminUserRouter());
  app.use('/api/v1/specialties', createSpecialtyRouter());
  app.use('/api/v1/doctor-application', createDoctorApplicationRouter());
  app.use('/api/v1/doctors', createDoctorRouter());
  app.use('/api/v1/admin/doctor-applications', createAdminDoctorApplicationRouter());
  app.use('/api/v1/admin/doctors', createAdminDoctorRouter());
  app.use('/api/v1/appointments', createPatientAppointmentRouter());
  app.use('/api/v1/payments', createPatientPaymentRouter());
  app.use('/api/v1/admin/finance', createAdminFinanceRouter());
  app.use('/api/v1/notifications', createNotificationRouter());
  app.use('/api/v1/consultations', createConsultationRouter());
  app.use('/api/v1/me', createMeRouter());
  app.use('/api/v1/prescriptions', createPrescriptionRouter());
  app.use('/api/v1/public/prescriptions', createPublicPrescriptionRouter());
  app.use('/api/v1/public/stats', createPublicStatsRouter());
  app.use('/api/v1/medical-documents', createMedicalDocumentRouter());
  app.use('/api/v1/admin/medical-records', createAdminRecordsRouter());
  app.use('/api/v1/admin/patients', createAdminPatientRouter());
  app.use('/api/v1/admin/appointments', createAdminAppointmentRouter());
  app.use('/api/v1/admin/reports', createAdminReportRouter());
  app.use('/api/v1/admin/audit-logs', createAdminAuditRouter());
  app.use('/api/v1/admin/settings', createAdminSettingsRouter());
  app.use('/api/v1/admin/sms-outbox', createAdminSmsRouter());
  app.use('/api/v1/admin/specialties', createAdminSpecialtyRouter());
  app.use('/api/v1/messages', createMessagingRouter());
  app.use('/api/v1/storage/local', createLocalStorageRouter());

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
