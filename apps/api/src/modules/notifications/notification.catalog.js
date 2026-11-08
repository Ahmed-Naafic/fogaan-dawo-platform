/**
 * Notification kinds: the single source of notification text (English + Somali) for the in-app list,
 * real-time updates and push. Text is rendered when read, in the reader's language and time zone, from
 * `data.kind` + `data.params` — so switching language re-renders old notifications too.
 *
 * Privacy: params carry only names, times, amounts and ids. Never diagnoses, notes, cancellation
 * reasons or anything from a consultation — push payloads go through third-party push services.
 *
 * `essential`: transactional notifications, always kept in-app. Optional ones (reminders) follow the
 * user's in-app / reminder preferences.
 */
export const NOTIFICATION_KINDS = Object.freeze({
  'appointment.booked': { type: 'BOOKING', essential: true },
  'payment.confirmed': { type: 'PAYMENT', essential: true },
  'appointment.new': { type: 'BOOKING', essential: true },
  'appointment.cancelled': { type: 'BOOKING', essential: true },
  'appointment.rescheduled': { type: 'BOOKING', essential: true },
  'appointment.reminder': { type: 'CONSULTATION', essential: false },
  'refund.requested': { type: 'REFUND', essential: true },
  'refund.completed': { type: 'REFUND', essential: true },
  'refund.failed': { type: 'REFUND', essential: true },
  'refund.rejected': { type: 'REFUND', essential: true },
  'application.submitted': { type: 'SYSTEM', essential: true },
  'application.review_started': { type: 'SYSTEM', essential: true },
  'application.approved': { type: 'SYSTEM', essential: true },
  'application.rejected': { type: 'SYSTEM', essential: true },
  'account.doctor_suspended': { type: 'SYSTEM', essential: true },
  'account.doctor_access_paused': { type: 'SYSTEM', essential: true },
  'admin.refund_requested': { type: 'REFUND', essential: true },
  'admin.refund_failed': { type: 'REFUND', essential: true },
  'admin.doctor_cancellations_flagged': { type: 'SYSTEM', essential: true },
  'followup.proposed': { type: 'FOLLOW_UP', essential: true },
  'followup.proposed.free': { type: 'FOLLOW_UP', essential: true },
  'followup.confirmed': { type: 'FOLLOW_UP', essential: true },
  'consultation.patient_waiting': { type: 'CONSULTATION', essential: true },
  'consultation.admitted': { type: 'CONSULTATION', essential: true },
  'consultation.rejected': { type: 'CONSULTATION', essential: true },
  'consultation.ended': { type: 'CONSULTATION', essential: true },
  'prescription.issued': { type: 'PRESCRIPTION', essential: true },
  'prescription.replaced': { type: 'PRESCRIPTION', essential: true },
  'prescription.cancelled': { type: 'PRESCRIPTION', essential: true },
  'consultation.summary_available': { type: 'CONSULTATION', essential: true },
  'document.shared': { type: 'CONSULTATION', essential: true },
  'document.uploaded': { type: 'CONSULTATION', essential: true },
});

const MESSAGES = {
  en: {
    'appointment.booked': ['Appointment reserved', 'Your consultation with {doctor} on {when} is reserved. Complete the payment to confirm it.'],
    'payment.confirmed': ['Payment confirmed', 'Your payment of {amount} was received. Your consultation with {doctor} on {when} is confirmed.'],
    'appointment.new': ['New appointment', '{patient} booked a consultation with you on {when}.'],
    'appointment.cancelled': ['Appointment cancelled', 'Your consultation with {counterpart} on {when} was cancelled.'],
    'appointment.cancelled.refund': ['Appointment cancelled', 'Your consultation with {counterpart} on {when} was cancelled. Your refund is being processed.'],
    'appointment.rescheduled': ['Appointment rescheduled', 'Your consultation with {counterpart} moved to {when}.'],
    'appointment.reminder.BEFORE_24H': ['Consultation tomorrow', 'Reminder: your consultation with {counterpart} is on {when}.'],
    'appointment.reminder.BEFORE_1H': ['Consultation in 1 hour', 'Your consultation with {counterpart} starts at {time}.'],
    'appointment.reminder.BEFORE_10M': ['Consultation in 10 minutes', 'Your consultation with {counterpart} starts at {time}. Open the appointment to get ready.'],
    'refund.requested': ['Refund requested', 'A refund of {amount} has been requested and will be processed soon.'],
    'refund.completed': ['Refund completed', 'Your refund of {amount} has been paid back.'],
    'refund.rejected': ['Refund request declined', 'Your refund request of {amount} was reviewed and declined. Contact support if you have questions.'],
    'refund.failed': ['Refund delayed', 'Your refund of {amount} could not be processed yet. Our team is working on it.'],
    'application.submitted': ['New doctor application', '{applicant} submitted a doctor application for verification.'],
    'application.review_started': ['Application under review', 'An administrator has started reviewing your doctor application.'],
    'application.approved': ['Doctor application approved', 'Your licence is verified. You can now use the doctor dashboard.'],
    'application.rejected': ['Doctor application needs changes', 'Your doctor application was not approved. Open it to see the reason and resubmit.'],
    'account.doctor_suspended': ['Doctor account suspended', 'Your doctor account has been suspended. Your upcoming appointments were cancelled. Contact support for details.'],
    'account.doctor_access_paused': ['Doctor access paused', 'Your doctor access is paused until your updated licence is verified.'],
    'admin.refund_requested': ['Refund to process', 'A refund of {amount} is waiting to be processed.'],
    'admin.refund_failed': ['Refund failed', 'A refund of {amount} failed and needs attention.'],
    'followup.proposed': ['Follow-up booked for you', '{doctor} booked a follow-up on {when} for {amount}. Pay before the deadline to confirm it, or the time is released.'],
    'followup.proposed.free': ['Free follow-up booked for you', '{doctor} booked a free follow-up on {when}. Confirm it before the deadline, or the time is released.'],
    'followup.confirmed': ['Follow-up confirmed', '{patient} confirmed the follow-up on {when}.'],
    'admin.doctor_cancellations_flagged': ['Doctor flagged for cancellations', '{doctor} has cancelled {count} appointments this month (more than 3). Review in Admin › Doctors.'],
    'consultation.patient_waiting': ['Patient waiting', '{patient} is in the waiting room for the consultation on {when}. Open it to admit them.'],
    'consultation.admitted': ['Consultation started', '{doctor} admitted you. Your video consultation has started.'],
    'consultation.rejected': ['Not admitted yet', "{doctor} couldn't admit you right now. You can try joining again while the consultation is open."],
    'consultation.ended': ['Consultation ended', 'Your video consultation with {doctor} has ended.'],
    'prescription.issued': ['New prescription', '{doctor} issued prescription {reference}. You can view and download it.'],
    'prescription.replaced': ['Prescription corrected', '{doctor} issued {reference} to replace an earlier prescription. Use the new one.'],
    'prescription.cancelled': ['Prescription cancelled', '{doctor} cancelled prescription {reference}. Do not use it.'],
    'consultation.summary_available': ['Consultation summary ready', 'Your summary from the consultation with {doctor} is available.'],
    'document.shared': ['New medical document', '{doctor} shared a document from your consultation.'],
    'document.uploaded': ['Patient shared a document', '{patient} uploaded a document to your consultation.'],
  },
  so: {
    'appointment.booked': ['Ballan waa la qabtay', 'La-tashigaaga {doctor} ee {when} waa la qabtay. Dhammee lacag-bixinta si loo xaqiijiyo.'],
    'payment.confirmed': ['Lacag-bixinta waa la xaqiijiyay', 'Lacagtaada {amount} waa la helay. La-tashigaaga {doctor} ee {when} waa la xaqiijiyay.'],
    'appointment.new': ['Ballan cusub', '{patient} ayaa kula qabsaday la-tashi {when}.'],
    'appointment.cancelled': ['Ballanta waa la joojiyay', 'La-tashigaaga {counterpart} ee {when} waa la joojiyay.'],
    'appointment.cancelled.refund': ['Ballanta waa la joojiyay', 'La-tashigaaga {counterpart} ee {when} waa la joojiyay. Lacag-celintaada waa la diyaarinayaa.'],
    'appointment.rescheduled': ['Ballanta waa la beddelay', 'La-tashigaaga {counterpart} waxa loo wareejiyay {when}.'],
    'appointment.reminder.BEFORE_24H': ['La-tashi berri', 'Xusuusin: la-tashigaaga {counterpart} waa {when}.'],
    'appointment.reminder.BEFORE_1H': ['La-tashi 1 saac kadib', 'La-tashigaaga {counterpart} wuxuu bilaabanayaa {time}.'],
    'appointment.reminder.BEFORE_10M': ['La-tashi 10 daqiiqo kadib', 'La-tashigaaga {counterpart} wuxuu bilaabanayaa {time}. Fur ballanta si aad u diyaargarowdo.'],
    'refund.requested': ['Lacag-celin ayaa la codsaday', 'Lacag-celin dhan {amount} ayaa la codsaday, dhawaan ayaana la fulin doonaa.'],
    'refund.completed': ['Lacag-celinta waa dhammaatay', 'Lacag-celintaada {amount} waa lagu soo celiyay.'],
    'refund.rejected': ['Codsiga lacag-celinta waa la diiday', 'Codsigaaga lacag-celinta ee {amount} waa la eegay waana la diiday. La xiriir taageerada haddii aad su\'aalo qabto.'],
    'refund.failed': ['Lacag-celinta waa dib u dhacday', 'Lacag-celintaada {amount} weli lama fulin karin. Kooxdayadu way ka shaqaynaysaa.'],
    'application.submitted': ['Codsi dhakhtar oo cusub', '{applicant} ayaa soo gudbiyay codsi dhakhtar si loo xaqiijiyo.'],
    'application.review_started': ['Codsiga waa la eegayaa', 'Maamule ayaa bilaabay dib-u-eegista codsigaaga dhakhtarka.'],
    'application.approved': ['Codsiga dhakhtarka waa la ansixiyay', 'Shatigaaga waa la xaqiijiyay. Hadda waxaad isticmaali kartaa bogga dhakhtarka.'],
    'application.rejected': ['Codsiga dhakhtarka wuxuu u baahan yahay isbeddel', 'Codsigaaga dhakhtarka lama ansixin. Fur si aad u aragto sababta oo dib u soo gudbi.'],
    'account.doctor_suspended': ['Akoonka dhakhtarka waa la hakiyay', 'Akoonkaaga dhakhtarka waa la hakiyay. Ballamahaagii soo socday waa la joojiyay. La xiriir taageerada.'],
    'account.doctor_access_paused': ['Gelitaanka dhakhtarka waa la hakiyay', 'Gelitaankaaga dhakhtarka waa la hakiyay ilaa shatigaaga cusub la xaqiijiyo.'],
    'admin.refund_requested': ['Lacag-celin la fulinayo', 'Lacag-celin dhan {amount} ayaa sugaysa in la fuliyo.'],
    'admin.refund_failed': ['Lacag-celin ayaa fashilantay', 'Lacag-celin dhan {amount} ayaa fashilantay, waxayna u baahan tahay fiiro.'],
    'followup.proposed': ['Ballan dabagal ah ayaa laguu qabtay', '{doctor} wuxuu kuu qabtay ballan dabagal ah {when} oo ah {amount}. Bixi ka hor wakhtiga kama dambaysta ah si loo xaqiijiyo, haddii kale wakhtiga waa la sii deynayaa.'],
    'followup.proposed.free': ['Ballan dabagal ah oo bilaash ah', '{doctor} wuxuu kuu qabtay ballan dabagal ah oo bilaash ah {when}. Xaqiiji ka hor wakhtiga kama dambaysta ah, haddii kale wakhtiga waa la sii deynayaa.'],
    'followup.confirmed': ['Dabagalka waa la xaqiijiyay', '{patient} wuxuu xaqiijiyay ballanta dabagalka ee {when}.'],
    'admin.doctor_cancellations_flagged': ['Dhakhtar loo calaameeyay joojinno', '{doctor} wuxuu bishan joojiyay {count} ballan (in ka badan 3). Ka eeg Maamulka › Dhakhaatiirta.'],
    'consultation.patient_waiting': ['Bukaan ayaa sugaya', '{patient} wuxuu ku jiraa qolka sugitaanka ee la-tashiga {when}. Fur si aad u soo gasho.'],
    'consultation.admitted': ['La-tashigu wuu bilaabmay', '{doctor} ayaa ku soo galiyay. La-tashigaaga muuqaalka ahi wuu bilaabmay.'],
    'consultation.rejected': ['Weli lama ku soo galin', '{doctor} hadda kuma soo galin karin. Waad isku dayi kartaa inaad mar kale ku biirto inta la-tashigu furan yahay.'],
    'consultation.ended': ['La-tashigu wuu dhammaaday', 'La-tashigaagii muuqaalka ahaa ee {doctor} wuu dhammaaday.'],
    'prescription.issued': ['Warqad daawo oo cusub', '{doctor} wuxuu bixiyay warqadda daawada {reference}. Waad arki kartaa oo soo dejisan kartaa.'],
    'prescription.replaced': ['Warqadda daawada waa la saxay', '{doctor} wuxuu bixiyay {reference} si uu u beddelo warqad hore. Isticmaal tan cusub.'],
    'prescription.cancelled': ['Warqadda daawada waa la joojiyay', '{doctor} wuxuu joojiyay warqadda daawada {reference}. Ha isticmaalin.'],
    'consultation.summary_available': ['Soo koobidda la-tashiga waa diyaar', 'Soo koobidda la-tashigaagii {doctor} waa la heli karaa.'],
    'document.shared': ['Dukumenti caafimaad oo cusub', '{doctor} wuxuu la wadaagay dukumenti la-tashigaaga.'],
    'document.uploaded': ['Bukaanku wuxuu wadaagay dukumenti', '{patient} wuxuu soo geliyay dukumenti la-tashigaaga.'],
  },
};

export const SUPPORTED_LANGUAGES = Object.freeze(['en', 'so']);
export const messageKeys = (lang) => Object.keys(MESSAGES[lang]);

function format(date, lang, timeZone, options) {
  try {
    return new Intl.DateTimeFormat(lang === 'so' ? 'so-SO' : 'en-GB', { timeZone, ...options }).format(date);
  } catch {
    return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', ...options }).format(date) + ' UTC';
  }
}

/** Which message a notification uses (some kinds have variants). */
function messageKey(kind, params) {
  if (kind === 'appointment.reminder') return `appointment.reminder.${params.reminder}`;
  if (kind === 'appointment.cancelled' && params.refund) return 'appointment.cancelled.refund';
  return kind;
}

/**
 * Title and body for a notification, in `lang`, with times shown in `timeZone` (the reader's zone).
 * Times are stored as UTC ISO strings in params.
 */
export function renderNotification({ kind, params = {} }, { lang = 'en', timeZone = 'Africa/Mogadishu' } = {}) {
  const language = SUPPORTED_LANGUAGES.includes(lang) ? lang : 'en';
  const template = MESSAGES[language][messageKey(kind, params)] ?? MESSAGES.en[messageKey(kind, params)];
  if (!template) return null;
  const at = params.startAtUtc ? new Date(params.startAtUtc) : null;
  const values = {
    ...params,
    when: at ? format(at, language, timeZone, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) : '',
    time: at ? format(at, language, timeZone, { hour: '2-digit', minute: '2-digit', hour12: false }) : '',
    amount: params.amount ? `$${params.amount}` : '',
  };
  const fill = (text) => text.replace(/\{(\w+)\}/g, (_, k) => (values[k] == null ? '' : String(values[k])));
  return { title: fill(template[0]), body: fill(template[1]) };
}

/** Where a notification opens in the web app (role-aware). */
export function notificationUrl({ kind, params = {}, role }) {
  const appt = params.appointmentId;
  if (appt && ['appointment.booked', 'payment.confirmed', 'appointment.cancelled', 'appointment.rescheduled', 'appointment.reminder'].includes(kind)) {
    return role === 'DOCTOR' ? `/doctor/appointments/${appt}` : `/patient/appointments/${appt}`;
  }
  if (kind === 'consultation.ended') return appt ? `/patient/appointments/${appt}` : '/patient/appointments';
  if (kind.startsWith('consultation.')) return appt ? `/consultation/${appt}` : '/account/notifications';
  if (kind.startsWith('followup.')) return appt ? (role === 'DOCTOR' ? `/doctor/appointments/${appt}` : `/patient/appointments/${appt}`) : '/account/notifications';
  if (kind === 'admin.doctor_cancellations_flagged') return '/admin/doctors';
  if (kind === 'appointment.new') return appt ? `/doctor/appointments/${appt}` : '/doctor/appointments';
  if (kind.startsWith('refund.')) return '/patient/payments';
  if (kind === 'application.submitted') return params.doctorId ? `/admin/verification/${params.doctorId}` : '/admin/verification';
  if (kind.startsWith('application.') || kind === 'account.doctor_access_paused') return '/patient/doctor-application';
  if (kind === 'account.doctor_suspended') return '/patient';
  if (kind.startsWith('admin.refund')) return '/admin/finance/refunds';
  if (kind.startsWith('prescription.')) return params.prescriptionId ? `/patient/prescriptions/${params.prescriptionId}` : '/patient/prescriptions';
  if (kind === 'consultation.summary_available') return appt ? `/patient/appointments/${appt}` : '/patient/documents';
  if (kind === 'document.shared') return '/patient/documents';
  if (kind === 'document.uploaded') return appt ? `/doctor/appointments/${appt}` : '/doctor/appointments';
  return '/account/notifications';
}
