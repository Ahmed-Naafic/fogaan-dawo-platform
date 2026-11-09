/** All routes of the web app: public pages, sign-in, and the patient, doctor and admin areas (each guarded by role). */
import { Navigate, Route, Routes } from 'react-router';
import ComingSoonPage from '@/components/shared/ComingSoonPage';
import LandingPage from '@/features/landing/pages/LandingPage';
import AuthPage from '@/features/auth/pages/AuthPage';
import GoogleCompletePage from '@/features/auth/pages/GoogleCompletePage';
import AccountLayout from '@/features/account/layouts/AccountLayout';
import AccountSecurityPage from '@/features/account/pages/AccountSecurityPage';
import NotificationsPage from '@/features/notifications/pages/NotificationsPage';
import PatientLayout from '@/features/patient/layouts/PatientLayout';
import PatientDashboard from '@/features/patient/pages/PatientDashboard';
import DoctorLayout from '@/features/doctor/layouts/DoctorLayout';
import DoctorDashboard from '@/features/doctor/pages/DoctorDashboard';
import DoctorPatientsPage from '@/features/doctor/pages/DoctorPatientsPage';
import DoctorPatientDetailPage from '@/features/doctor/pages/DoctorPatientDetailPage';
import MyEarningsPage from '@/features/doctor/pages/MyEarningsPage';
import MessagesPage from '@/features/messaging/pages/MessagesPage';
import AdminLayout from '@/features/admin/layouts/AdminLayout';
import AdminDashboard from '@/features/admin/pages/AdminDashboard';
import AdminSmsOutboxPage from '@/features/admin/pages/AdminSmsOutboxPage';
import AdminPatientsPage from '@/features/admin/pages/AdminPatientsPage';
import AdminPatientDetailPage from '@/features/admin/pages/AdminPatientDetailPage';
import AdminAppointmentsPage from '@/features/admin/pages/AdminAppointmentsPage';
import AdminAppointmentDetailPage from '@/features/admin/pages/AdminAppointmentDetailPage';
import AdminReportsPage from '@/features/admin/pages/AdminReportsPage';
import AdminAuditLogsPage from '@/features/admin/pages/AdminAuditLogsPage';
import AdminSettingsPage from '@/features/admin/pages/AdminSettingsPage';
import FindDoctorsPage from '@/features/doctors/pages/FindDoctorsPage';
import VideoConsultationPage from '@/features/video/pages/VideoConsultationPage';
import RequireRole from '@/features/auth/components/RequireRole';
import DoctorApplicationPage from '@/features/doctors/pages/DoctorApplicationPage';
import DoctorVerificationPage from '@/features/admin/pages/DoctorVerificationPage';
import DoctorApplicationReviewPage from '@/features/admin/pages/DoctorApplicationReviewPage';
import DoctorProfilePage from '@/features/doctors/pages/DoctorProfilePage';
import PublicDirectoryLayout from '@/features/doctors/layouts/PublicDirectoryLayout';
import AvailabilityPage from '@/features/availability/pages/AvailabilityPage';
import AdminDoctorsPage from '@/features/admin/pages/AdminDoctorsPage';
import AppointmentsListPage from '@/features/appointments/pages/AppointmentsListPage';
import AppointmentDetailPage from '@/features/appointments/pages/AppointmentDetailPage';
import CheckoutPage from '@/features/payments/pages/CheckoutPage';
import PaymentHistoryPage from '@/features/payments/pages/PaymentHistoryPage';
import FinanceOverviewPage from '@/features/finance/pages/FinanceOverviewPage';
import FinancePaymentsPage from '@/features/finance/pages/FinancePaymentsPage';
import FinanceRefundsPage from '@/features/finance/pages/FinanceRefundsPage';
import DoctorEarningsPage from '@/features/finance/pages/DoctorEarningsPage';
import FinanceReportsPage from '@/features/finance/pages/FinanceReportsPage';
import FinanceSettingsPage from '@/features/finance/pages/FinanceSettingsPage';
import LegacyPaymentsRedirect from '@/features/finance/LegacyPaymentsRedirect';
import PatientProfilePage from '@/features/profile/pages/PatientProfilePage';
import MedicalInformationPage from '@/features/profile/pages/MedicalInformationPage';
import DoctorProfessionalProfilePage from '@/features/profile/pages/DoctorProfessionalProfilePage';
import PrescriptionsListPage from '@/features/prescriptions/pages/PrescriptionsListPage';
import PrescriptionDetailPage from '@/features/prescriptions/pages/PrescriptionDetailPage';
import VerifyPrescriptionPage from '@/features/prescriptions/pages/VerifyPrescriptionPage';
import PatientDocumentsPage from '@/features/prescriptions/pages/PatientDocumentsPage';
import AdminMedicalRecordsPage from '@/features/prescriptions/pages/AdminMedicalRecordsPage';

// Guards give the right screen for the session; the API independently enforces every permission.

export default function AppRouter() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<AuthPage />} />
      <Route path="/register" element={<AuthPage mode="register" />} />
      <Route path="/auth/google/complete" element={<GoogleCompletePage />} />
      {/* Public QR verification (no login; the API returns no patient or clinical data). */}
      <Route path="/verify/:token" element={<VerifyPrescriptionPage />} />

      {/* Shared account pages for every role (shown in the active role's frame). */}
      <Route
        path="/account"
        element={
          <RequireRole roles={['PATIENT', 'DOCTOR', 'ADMIN']}>
            <AccountLayout />
          </RequireRole>
        }
      >
        <Route index element={<Navigate to="security" replace />} />
        <Route path="security" element={<AccountSecurityPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="*" element={<Navigate to="/account/security" replace />} />
      </Route>
      <Route
        path="/consultation/:id"
        element={
          <RequireRole roles={['PATIENT', 'DOCTOR']}>
            <VideoConsultationPage />
          </RequireRole>
        }
      />

      <Route
        path="/patient"
        element={
          <RequireRole roles={['PATIENT']}>
            <PatientLayout />
          </RequireRole>
        }
      >
        <Route index element={<PatientDashboard />} />
        <Route path="doctors" element={<FindDoctorsPage />} />
        <Route path="doctors/:doctorId" element={<DoctorProfilePage />} />
        <Route path="doctor-application" element={<DoctorApplicationPage />} />
        <Route path="appointments" element={<AppointmentsListPage viewer="PATIENT" />} />
        <Route path="appointments/:appointmentId" element={<AppointmentDetailPage viewer="PATIENT" />} />
        <Route path="appointments/:appointmentId/pay" element={<CheckoutPage />} />
        <Route path="payments" element={<PaymentHistoryPage />} />
        <Route path="profile" element={<PatientProfilePage />} />
        <Route path="records" element={<MedicalInformationPage />} />
        <Route path="prescriptions" element={<PrescriptionsListPage viewer="PATIENT" />} />
        <Route path="prescriptions/:prescriptionId" element={<PrescriptionDetailPage viewer="PATIENT" />} />
        <Route path="documents" element={<PatientDocumentsPage />} />
        <Route path="messages" element={<MessagesPage viewer="PATIENT" />} />
        <Route path="messages/:appointmentId" element={<MessagesPage viewer="PATIENT" />} />
        <Route path="*" element={<ComingSoonPage />} />
      </Route>

      <Route
        path="/doctor"
        element={
          <RequireRole roles={['DOCTOR']}>
            <DoctorLayout />
          </RequireRole>
        }
      >
        <Route index element={<DoctorDashboard />} />
        <Route path="availability" element={<AvailabilityPage />} />
        <Route path="profile" element={<DoctorProfessionalProfilePage />} />
        <Route path="prescriptions" element={<PrescriptionsListPage viewer="DOCTOR" />} />
        <Route path="prescriptions/:prescriptionId" element={<PrescriptionDetailPage viewer="DOCTOR" />} />
        <Route path="appointments" element={<AppointmentsListPage viewer="DOCTOR" />} />
        <Route path="appointments/:appointmentId" element={<AppointmentDetailPage viewer="DOCTOR" />} />
        <Route path="patients" element={<DoctorPatientsPage />} />
        <Route path="patients/:patientId" element={<DoctorPatientDetailPage />} />
        <Route path="earnings" element={<MyEarningsPage />} />
        <Route path="messages" element={<MessagesPage viewer="DOCTOR" />} />
        <Route path="messages/:appointmentId" element={<MessagesPage viewer="DOCTOR" />} />
        <Route path="*" element={<ComingSoonPage />} />
      </Route>

      <Route
        path="/admin"
        element={
          <RequireRole roles={['ADMIN']}>
            <AdminLayout />
          </RequireRole>
        }
      >
        <Route index element={<AdminDashboard />} />
        <Route path="doctors" element={<AdminDoctorsPage />} />
        <Route path="payments" element={<LegacyPaymentsRedirect />} />
        <Route path="finance" element={<FinanceOverviewPage />} />
        <Route path="finance/payments" element={<FinancePaymentsPage />} />
        <Route path="finance/refunds" element={<FinanceRefundsPage />} />
        <Route path="finance/doctor-earnings" element={<DoctorEarningsPage />} />
        <Route path="finance/reports" element={<FinanceReportsPage />} />
        <Route path="finance/settings" element={<FinanceSettingsPage />} />
        <Route path="medical-records" element={<AdminMedicalRecordsPage />} />
        <Route path="verification" element={<DoctorVerificationPage />} />
        <Route path="verification/:doctorId" element={<DoctorApplicationReviewPage />} />
        <Route path="patients" element={<AdminPatientsPage />} />
        <Route path="patients/:patientId" element={<AdminPatientDetailPage />} />
        <Route path="appointments" element={<AdminAppointmentsPage />} />
        <Route path="appointments/:appointmentId" element={<AdminAppointmentDetailPage />} />
        <Route path="reports" element={<AdminReportsPage />} />
        <Route path="audit-logs" element={<AdminAuditLogsPage />} />
        <Route path="sms-outbox" element={<AdminSmsOutboxPage />} />
        <Route path="settings" element={<AdminSettingsPage />} />
        <Route path="*" element={<ComingSoonPage />} />
      </Route>

      {/* Public directory: no login needed (only verified, active doctors are ever returned). */}
      <Route path="/doctors" element={<PublicDirectoryLayout />}>
        <Route index element={<FindDoctorsPage />} />
        <Route path=":doctorId" element={<DoctorProfilePage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
