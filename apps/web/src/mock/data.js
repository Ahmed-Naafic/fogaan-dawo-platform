/**
 * PHASE 1 MOCK DATA — static, read-only demo content.
 * Do not import from pages directly; go through src/services/.
 * Translatable values (specialties, statuses, visit types) are stored as keys.
 */
import drMaxamed from '@/assets/images/dr-maxamed.jpg';
import drHodan from '@/assets/images/dr-hodan.jpg';
import drCabdiwali from '@/assets/images/dr-cabdiwali.jpg';
import drCali from '@/assets/images/dr-cali.jpg';
import amina from '@/assets/images/amina.jpg';
import cabdullaahi from '@/assets/images/cabdullaahi.jpg';
import fadumo from '@/assets/images/fadumo.jpg';
import admin from '@/assets/images/admin.jpg';

export const users = {
  patient: { id: 'PT-10348', name: 'Amina Cabdi', firstName: 'Amina', role: 'patient', avatar: amina, gender: 'female', age: 28 },
  doctor: { id: 'DR-2041', name: 'Dr. Cali Yuusuf', firstName: 'Cali', role: 'doctor', avatar: drCali },
  admin: { id: 'AD-0001', name: 'Admin', firstName: 'Admin', role: 'superAdmin', avatar: admin },
};

export const doctors = [
  {
    id: 'dr-maxamed-faarax',
    name: 'Dr. Maxamed Faarax',
    specialty: 'cardiology',
    rating: 4.9,
    reviews: 324,
    fee: 20,
    avatar: drMaxamed,
    verified: true,
    tags: ['heartHealth', 'hypertension', 'heartDisease'],
    languages: ['so', 'en'],
    location: 'Mogadishu',
  },
  {
    id: 'dr-hodan-axmed',
    name: 'Dr. Hodan Axmed',
    specialty: 'dermatology',
    rating: 4.8,
    reviews: 216,
    fee: 18,
    avatar: drHodan,
    verified: true,
    tags: ['skinCare', 'acne', 'allergy'],
    languages: ['so', 'en', 'ar'],
    location: 'Hargeisa',
  },
  {
    id: 'dr-cabdiwali-nuur',
    name: 'Dr. Cabdiwali Nuur',
    specialty: 'pediatrics',
    rating: 4.9,
    reviews: 287,
    fee: 15,
    avatar: drCabdiwali,
    verified: true,
    tags: ['childHealth', 'vaccination', 'growth'],
    languages: ['so', 'en'],
    location: 'London',
  },
  {
    id: 'dr-cali-yuusuf',
    name: 'Dr. Cali Yuusuf',
    specialty: 'general',
    rating: 4.7,
    reviews: 198,
    fee: 12,
    avatar: drCali,
    verified: true,
    tags: ['checkup', 'fever', 'chronicCare'],
    languages: ['so', 'en'],
    location: 'Minneapolis',
    listed: false, // signed-in doctor's own profile; portrait source is too small for directory cards
  },
];

// `primary` specialties appear as quick filters on dashboards; all appear on the landing page.
export const specialties = [
  { key: 'general', icon: 'Stethoscope', tone: 'teal', doctors: 412, primary: true },
  { key: 'cardiology', icon: 'HeartPulse', tone: 'rose', doctors: 96, primary: true },
  { key: 'dermatology', icon: 'Sparkles', tone: 'blue', doctors: 74, primary: true },
  { key: 'pediatrics', icon: 'Baby', tone: 'purple', doctors: 138, primary: true },
  { key: 'gynecology', icon: 'Flower2', tone: 'rose', doctors: 121 },
  { key: 'mentalHealth', icon: 'Brain', tone: 'gold', doctors: 64 },
  { key: 'nutrition', icon: 'Apple', tone: 'green', doctors: 52 },
  { key: 'orthopedics', icon: 'Bone', tone: 'blue', doctors: 47 },
];

/** Patient view */
export const patientStats = { upcoming: 1, completed: 4, prescriptions: 3, records: 5 };

export const nextAppointment = {
  id: 'apt-7781',
  doctorId: 'dr-maxamed-faarax',
  date: '2026-11-02T15:00:00',
  durationMin: 30,
  type: 'video',
};

/** Doctor view */
export const doctorStats = { today: 6, waiting: 2, completed: 18, earnings: 540 };

export const todaysAppointments = [
  { id: 'a1', patient: 'Amina Cabdi', avatar: amina, time: '15:00', end: '15:30', type: 'generalConsultation', status: 'inSession' },
  { id: 'a2', patient: 'Cabdullaahi Xasan', avatar: cabdullaahi, time: '15:30', end: '16:00', type: 'followUp', status: 'waiting' },
  { id: 'a3', patient: 'Fadumo Nuur', avatar: fadumo, time: '16:00', end: '16:30', type: 'consultation', status: 'upcoming' },
];

export const weeklyAvailability = [
  { day: 'mon', from: '18:00', to: '21:00', enabled: true },
  { day: 'tue', from: '18:00', to: '21:00', enabled: true },
  { day: 'wed', from: '18:00', to: '21:00', enabled: false },
  { day: 'thu', from: '18:00', to: '21:00', enabled: true },
];

/** Admin view */
export const adminStats = {
  users: { value: 26480, trend: '+12%' },
  doctors: { value: 1248, trend: '+8%' },
  appointments: { value: 8920, trend: '+18%' },
  revenue: { value: 124560, trend: '+21%' },
  pendingVerification: 12,
};

// Shape follows the reference chart: dip mid-week, strong weekend climb.
export const weeklyAppointments = [
  { day: 'mon', value: 190 },
  { day: 'tue', value: 330 },
  { day: 'wed', value: 520 },
  { day: 'thu', value: 430 },
  { day: 'fri', value: 690 },
  { day: 'sat', value: 560 },
  { day: 'sun', value: 960 },
];

export const lastWeekAppointments = [
  { day: 'mon', value: 160 },
  { day: 'tue', value: 240 },
  { day: 'wed', value: 410 },
  { day: 'thu', value: 380 },
  { day: 'fri', value: 520 },
  { day: 'sat', value: 610 },
  { day: 'sun', value: 740 },
];

export const monthlyRevenue = [
  { month: 'aug', value: 8200 },
  { month: 'sep', value: 10400 },
  { month: 'oct', value: 12600 },
  { month: 'nov', value: 18600 },
];

export const pendingDoctors = [
  { id: 'v1', name: 'Dr. Nur Cabdi', specialty: 'cardiology', avatar: drCali, submitted: '2026-11-01' },
  { id: 'v2', name: 'Dr. Hodan Axmed', specialty: 'dermatology', avatar: drHodan, submitted: '2026-11-01' },
  { id: 'v3', name: 'Dr. Cabdiwaali Faarax', specialty: 'pediatrics', avatar: drCabdiwali, submitted: '2026-11-02' },
];

/** Consultation room */
export const activeConsultation = {
  id: 'apt-7781',
  doctorId: 'dr-maxamed-faarax',
  patient: users.patient,
  notes: 'Patient reports headache and fatigue for 3 days. No fever.',
  startedSecondsAgo: 28 * 60 + 14,
  chat: [
    { from: 'doctor', text: 'Hello Amina, can you hear me clearly?', time: '15:01' },
    { from: 'patient', text: 'Yes doctor, I can hear you well.', time: '15:01' },
  ],
  files: [{ name: 'Blood test — Oct 2026.pdf', size: '284 KB' }],
};

export const platformStats = { doctors: '1,200+', consultations: '25,000+', satisfaction: '98%' };
