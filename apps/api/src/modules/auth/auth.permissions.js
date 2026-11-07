/**
 * Permissions granted by each role. Authorization checks the *active* role of the session.
 * Business modules add their permissions here as they are built.
 */
export const Permission = Object.freeze({
  ownProfileRead: 'profile:read:own',
  ownSessionsManage: 'sessions:manage:own',
  rolesAssign: 'roles:assign',
  /** Create, edit and submit one's own doctor application. */
  ownDoctorApplicationManage: 'doctor-application:manage:own',
  /** Read one's own verified doctor profile (doctor dashboard). */
  ownDoctorProfileRead: 'doctor-profile:read:own',
  /** Review, approve and reject doctor applications. */
  doctorsVerify: 'doctors:verify',
  /** Manage one's own weekly availability, blocked periods and published slots. */
  ownAvailabilityManage: 'availability:manage:own',
  /** List registered doctors and suspend them (admin doctor management). */
  doctorsManage: 'doctors:manage',
  /** Book, view, cancel and reschedule one's own appointments (patient). */
  ownAppointmentsManage: 'appointments:manage:own',
  /** View and cancel the appointments booked with oneself (doctor). */
  doctorAppointmentsManage: 'appointments:manage:doctor',
  /** View simulated payments and refunds; process refunds (admin finance). */
  financeManage: 'finance:manage',
  /** Join, run and leave video consultations of one's own appointments (patient or assigned doctor). */
  ownConsultationsJoin: 'consultations:join:own',
  /** Read and edit one's own longitudinal medical history (patient; never another patient's). */
  ownMedicalHistoryManage: 'medical-history:manage:own',
  /** Edit one's own professional profile and replace one's licence (verified doctor). */
  ownDoctorProfileManage: 'doctor-profile:manage:own',
  /** Read (only) the medical information of patients from one's own eligible appointments (doctor). */
  assignedPatientRecordsRead: 'patient-records:read:assigned',
  /** Write, issue, replace and cancel prescriptions for one's own consultations (verified doctor). */
  assignedPrescriptionsWrite: 'prescriptions:write:assigned',
  /** Read one's own prescriptions and consultation summaries (patient). */
  ownPrescriptionsRead: 'prescriptions:read:own',
  /** Share, read and archive documents of consultations one takes part in (patient or assigned doctor). */
  consultationDocumentsManage: 'medical-documents:manage:participant',
  /** Metadata-only monitoring of prescriptions and medical documents (administrator; no clinical content). */
  medicalRecordsMonitor: 'medical-records:monitor',
  /** Read one's own calculated consultation earnings (doctor). */
  ownEarningsRead: 'earnings:read:own',
});

export const ROLE_PERMISSIONS = Object.freeze({
  PATIENT: Object.freeze([Permission.ownProfileRead, Permission.ownSessionsManage, Permission.ownDoctorApplicationManage, Permission.ownAppointmentsManage, Permission.ownConsultationsJoin, Permission.ownMedicalHistoryManage, Permission.ownPrescriptionsRead, Permission.consultationDocumentsManage]),
  DOCTOR: Object.freeze([Permission.ownProfileRead, Permission.ownSessionsManage, Permission.ownDoctorApplicationManage, Permission.ownDoctorProfileRead, Permission.ownAvailabilityManage, Permission.doctorAppointmentsManage, Permission.ownConsultationsJoin, Permission.ownDoctorProfileManage, Permission.assignedPatientRecordsRead, Permission.assignedPrescriptionsWrite, Permission.consultationDocumentsManage, Permission.ownEarningsRead]),
  ADMIN: Object.freeze([Permission.ownProfileRead, Permission.ownSessionsManage, Permission.rolesAssign, Permission.doctorsVerify, Permission.doctorsManage, Permission.financeManage, Permission.medicalRecordsMonitor]),
});

export const permissionsFor = (role) => ROLE_PERMISSIONS[role] ?? [];
export const roleHasPermission = (role, permission) => permissionsFor(role).includes(permission);
