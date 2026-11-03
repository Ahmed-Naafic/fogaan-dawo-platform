/**
 * Data access layer.
 * PHASE 1: every function returns static mock data from src/mock/data.js.
 * PHASE 2: replace the bodies with real API calls — page code stays unchanged.
 * Functions are synchronous today; convert to async together with a data-fetching hook in Phase 2.
 */
import * as mock from '@/mock/data';

export const getCurrentUser = (role) => mock.users[role];

// Doctor directory (the doctor-user profile is kept in mock.doctors for lookups but is not listed).
export const getDoctors = () => mock.doctors.filter((d) => d.listed !== false);
export const getDoctorById = (id) => mock.doctors.find((d) => d.id === id);
export const getSpecialties = () => mock.specialties;

export const getPatientStats = () => mock.patientStats;
export const getNextAppointment = () => {
  const apt = mock.nextAppointment;
  return { ...apt, doctor: getDoctorById(apt.doctorId) };
};

export const getDoctorStats = () => mock.doctorStats;
export const getTodaysAppointments = () => mock.todaysAppointments;
export const getWeeklyAvailability = () => mock.weeklyAvailability;

export const getAdminStats = () => mock.adminStats;
export const getAppointmentsOverview = (range = 'thisWeek') =>
  range === 'lastWeek' ? mock.lastWeekAppointments : mock.weeklyAppointments;
export const getMonthlyRevenue = () => mock.monthlyRevenue;
export const getPendingDoctors = () => mock.pendingDoctors;

export const getConsultation = () => {
  const c = mock.activeConsultation;
  return { ...c, doctor: getDoctorById(c.doctorId) };
};

export const getPlatformStats = () => mock.platformStats;
