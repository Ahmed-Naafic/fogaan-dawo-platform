import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/features/auth/AuthProvider';
import { useI18n } from '@/lib/i18n';
import { bookingErrorKey } from './booking';
import { bookSlot } from './services/appointmentApi';

/**
 * "Reserve this time": signed-out visitors go to sign in (and come back to the doctor's profile in the
 * patient area); a signed-in user with a patient account books as PATIENT; then the reservation (with
 * its payment countdown) opens. The server re-checks everything — the slot, the doctor, the patient.
 */
export function useReserveSlot(doctorId) {
  const auth = useAuth();
  const navigate = useNavigate();
  const notify = useToast();
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);

  const reserve = async (slot) => {
    if (auth.status !== 'authenticated') {
      navigate(`/login?next=${encodeURIComponent(`/patient/doctors/${doctorId}`)}`);
      return false;
    }
    if (!auth.session.roles.includes('PATIENT')) {
      notify(t('bookingErrors.PATIENT_PROFILE_REQUIRED'), 'error');
      return false;
    }
    setBusy(true);
    try {
      if (auth.session.activeRole !== 'PATIENT') await auth.switchRole('PATIENT');
      const appointment = await bookSlot(slot.id);
      navigate(`/patient/appointments/${appointment.id}`);
      return true;
    } catch (error) {
      notify(t(bookingErrorKey(error)), 'error');
      return false;
    } finally {
      setBusy(false);
    }
  };

  return { reserve, busy };
}
