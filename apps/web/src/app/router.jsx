import { Navigate, Route, Routes } from 'react-router-dom';
import ComingSoonPage from '@/components/shared/ComingSoonPage';
import LandingPage from '@/features/landing/pages/LandingPage';
import AuthPage from '@/features/auth/pages/AuthPage';
import PatientLayout from '@/features/patient/layouts/PatientLayout';
import PatientDashboard from '@/features/patient/pages/PatientDashboard';
import DoctorLayout from '@/features/doctor/layouts/DoctorLayout';
import DoctorDashboard from '@/features/doctor/pages/DoctorDashboard';
import AdminLayout from '@/features/admin/layouts/AdminLayout';
import AdminDashboard from '@/features/admin/pages/AdminDashboard';
import FindDoctorsPage from '@/features/doctors/pages/FindDoctorsPage';
import VideoConsultationPage from '@/features/video/pages/VideoConsultationPage';

export default function AppRouter() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<AuthPage />} />
      <Route path="/register" element={<AuthPage mode="register" />} />
      <Route path="/consultation/:id" element={<VideoConsultationPage />} />

      <Route path="/patient" element={<PatientLayout />}>
        <Route index element={<PatientDashboard />} />
        <Route path="doctors" element={<FindDoctorsPage />} />
        <Route path="*" element={<ComingSoonPage />} />
      </Route>

      <Route path="/doctor" element={<DoctorLayout />}>
        <Route index element={<DoctorDashboard />} />
        <Route path="*" element={<ComingSoonPage />} />
      </Route>

      <Route path="/admin" element={<AdminLayout />}>
        <Route index element={<AdminDashboard />} />
        <Route path="*" element={<ComingSoonPage />} />
      </Route>

      <Route path="/doctors" element={<Navigate to="/patient/doctors" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
