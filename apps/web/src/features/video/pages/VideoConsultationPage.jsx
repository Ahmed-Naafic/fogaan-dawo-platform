/** Video consultation: pre-join checks, waiting room, doctor admission, WebRTC call with mute/camera/end/timer, side panel (notes, prescriptions, chat, files). */
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import {
  AlertTriangle,
  CalendarClock,
  ChevronLeft,
  Clock3,
  Hourglass,
  Loader2,
  LogOut,
  Maximize,
  Mic,
  MicOff,
  Minimize,
  MoreHorizontal,
  Phone,
  PhoneOff,
  ShieldCheck,
  SignalHigh,
  SignalLow,
  SignalMedium,
  UserCheck,
  UserX,
  Video,
  VideoOff,
  WifiOff,
} from 'lucide-react';
import { LogoMark } from '@/components/shared/Logo';
import LanguageSwitcher from '@/components/shared/LanguageSwitcher';
import ThemeToggle from '@/components/shared/ThemeToggle';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/features/auth/AuthProvider';
import NoShowRefundButton from '@/features/appointments/components/NoShowRefundButton';
import * as appointmentApi from '@/features/appointments/services/appointmentApi';
import ConsultationPanel from '@/features/consultations/components/ConsultationPanel';
import useConsultationCall from '@/features/consultations/useConsultationCall';
import { formatClock } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { browserTimeZone, formatDateTime } from '@/lib/timezone';
import { cn } from '@/lib/cn';
import CallControl from '../components/CallControl';
import RemoteVideo from '../components/RemoteVideo';
import SelfView from '../components/SelfView';

/** Seconds since the server-recorded start, ticking with the server clock offset. */
function useElapsed(startedAt, offset, running) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);
  if (!startedAt) return null;
  return Math.max(0, Math.floor((now + offset - new Date(startedAt).getTime()) / 1000));
}

/** Centered card on the dark video stage (pre-join, waiting room, admission, end states). */
function StageCard({ icon: Icon, tone = 'default', title, children, testId }) {
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center p-4 pb-32 pt-24 lg:pb-24 lg:pt-4" data-stage={testId}>
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0B2B3C]/90 p-6 text-center shadow-float backdrop-blur-md">
        {Icon && (
          <span className={cn('mx-auto flex h-12 w-12 items-center justify-center rounded-2xl', tone === 'warn' ? 'bg-amber-400/15 text-amber-300' : tone === 'danger' ? 'bg-red-500/15 text-red-300' : 'bg-white/10 text-white')}>
            <Icon className="h-6 w-6" />
          </span>
        )}
        <h2 className="mt-4 text-lg font-bold text-white">{title}</h2>
        <div className="mt-2 space-y-4 text-sm text-white/75">{children}</div>
      </div>
    </div>
  );
}

const stageButton = 'inline-flex h-11 items-center justify-center gap-2 rounded-xl px-5 text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 disabled:opacity-50';
const primaryBtn = cn(stageButton, 'bg-primary text-primary-fg hover:bg-primary-hover');
const ghostBtn = cn(stageButton, 'border border-white/20 text-white hover:bg-white/10');
const dangerBtn = cn(stageButton, 'bg-red-500 text-white hover:bg-red-600');

function ConnectionIndicator({ call, inCall, className }) {
  const { t } = useI18n();
  let Icon = SignalHigh;
  let color = 'text-emerald-400';
  let label = t('consult.goodConnection');
  if (call.signalState === 'reconnecting') [Icon, color, label] = [WifiOff, 'text-amber-300', t('consult.connection.reconnecting')];
  else if (inCall && call.failed) [Icon, color, label] = [WifiOff, 'text-red-400', t('consult.connection.failed')];
  else if (inCall && !['connected', 'completed'].includes(call.iceState)) [Icon, color, label] = [Loader2, 'text-white/80 animate-spin', t('consult.connection.connecting')];
  else if (call.quality === 'poor') [Icon, color, label] = [SignalLow, 'text-red-400', t('consult.connection.poor')];
  else if (call.quality === 'fair') [Icon, color, label] = [SignalMedium, 'text-amber-300', t('consult.connection.fair')];
  return (
    <span className={cn('flex items-center gap-1.5 text-xs text-white/80', className)} role="status" data-connection={call.failed ? 'failed' : call.iceState}>
      <Icon className={cn('h-4 w-4', color)} aria-hidden="true" />
      <span className="sr-only lg:not-sr-only">{label}</span>
    </span>
  );
}

const ERROR_KEYS = {
  CONSULTATION_TOO_EARLY: 'consult.errors.tooEarly',
  CONSULTATION_TOO_LATE: 'consult.errors.tooLate',
  CONSULTATION_NOT_PAID: 'consult.errors.notPaid',
  CONSULTATION_NOT_JOINABLE: 'consult.errors.notJoinable',
  CONSULTATION_ENDED: 'consult.errors.ended',
  CONSULTATION_NOTES_REQUIRED: 'consult.errors.notesRequired',
  DOCTOR_NOT_ACTIVE: 'consult.errors.doctorNotActive',
  ROLE_UNAVAILABLE: 'consult.errors.doctorNotActive',
  PATIENT_NOT_WAITING: 'consult.errors.patientNotWaiting',
  NOT_FOUND: 'consult.errors.notFound',
  NETWORK_ERROR: 'consult.errors.network',
};
const BLOCKER_CODE = { TOO_EARLY: 'CONSULTATION_TOO_EARLY', TOO_LATE: 'CONSULTATION_TOO_LATE', NOT_PAID: 'CONSULTATION_NOT_PAID', NOT_JOINABLE: 'CONSULTATION_NOT_JOINABLE', ENDED: 'CONSULTATION_ENDED' };
const MEDIA_KEYS = { DENIED: 'consult.media.denied', INSECURE: 'consult.media.insecure', UNSUPPORTED: 'consult.media.unsupported', NO_CAMERA: 'consult.media.noCamera', CAMERA_UNAVAILABLE: 'consult.media.cameraUnavailable', NO_DEVICES: 'consult.media.noDevices' };

export default function VideoConsultationPage() {
  const { id: appointmentId } = useParams();
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const notify = useToast();
  const auth = useAuth();
  const role = auth.session?.activeRole === 'DOCTOR' ? 'DOCTOR' : 'PATIENT';
  const call = useConsultationCall({ appointmentId, role });
  const [appointment, setAppointment] = useState(null);
  const [missing, setMissing] = useState(false);
  const [tab, setTab] = useState('consultation');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [isFull, setIsFull] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const shownMediaIssue = useRef(null);

  const appointmentPath = `${role === 'DOCTOR' ? '/doctor' : '/patient'}/appointments/${appointmentId}`;

  useEffect(() => {
    let cancelled = false;
    (role === 'DOCTOR' ? appointmentApi.getDoctorAppointment(appointmentId) : appointmentApi.getMyAppointment(appointmentId))
      .then((a) => !cancelled && setAppointment(a))
      .catch(() => !cancelled && setMissing(true));
    return () => {
      cancelled = true;
    };
  }, [appointmentId, role, call.phase, tick]);

  // Before joining, re-check eligibility every 30 s so the Join button opens when the window does.
  const waitingToOpen = call.phase === 'idle' && appointment?.actions?.join?.blocker === 'TOO_EARLY';
  useEffect(() => {
    if (!waitingToOpen) return undefined;
    const id = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, [waitingToOpen]);

  useEffect(() => {
    const onChange = () => setIsFull(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  // Informational device problems (joined anyway) are shown once.
  useEffect(() => {
    if (call.phase === 'active' && call.mediaIssue && shownMediaIssue.current !== call.mediaIssue) {
      shownMediaIssue.current = call.mediaIssue;
      notify(t(MEDIA_KEYS[call.mediaIssue]));
    }
  }, [call.phase, call.mediaIssue, notify, t]);

  // Action errors (admit/reject/end) are shown as a toast.
  useEffect(() => {
    if (call.error?.transient) {
      notify(t(ERROR_KEYS[call.error.code] ?? 'consult.errors.generic'), 'error');
      // Ending needs notes first: open the notes panel so the doctor can write them.
      if (call.error.code === 'CONSULTATION_NOTES_REQUIRED') openPanel('consultation');
      call.clearError();
    }
  }, [call, notify, t]);

  useEffect(() => {
    if (!confirmEnd) return undefined;
    const id = setTimeout(() => setConfirmEnd(false), 5000);
    return () => clearTimeout(id);
  }, [confirmEnd]);

  const c = call.consultation;
  const otherName = c ? (role === 'DOCTOR' ? c.patient.name : c.doctor.name) : appointment ? (role === 'DOCTOR' ? appointment.patient?.name : appointment.doctor?.name) : '';
  const selfName = c ? (role === 'DOCTOR' ? c.doctor.name : c.patient.name) : auth.session?.user?.fullName ?? '';
  const admission = c?.admission;
  const inCall = call.phase === 'active' && admission === 'IN_CALL';
  const otherPresent = role === 'DOCTOR' ? call.presence.patient : call.presence.doctor;
  const elapsed = useElapsed(c?.startedAt, call.clockOffset, inCall);
  const clock = call.phase === 'ended' && c?.durationSeconds != null ? formatClock(c.durationSeconds) : elapsed != null ? formatClock(elapsed) : '--:--';
  const fmt = (iso) => formatDateTime(iso, browserTimeZone(), locale);

  const toggleFull = () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  };
  const goBack = async () => {
    if (call.phase === 'active') await call.leave();
    navigate(appointmentPath);
  };
  const doAction = async (fn) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };
  const endCall = () => {
    if (!confirmEnd) return setConfirmEnd(true);
    setConfirmEnd(false);
    return doAction(async () => {
      if (await call.end()) notify(t('consult.ended'), 'success');
    });
  };
  const openPanel = (which) => {
    setTab(which);
    setSheetOpen(true);
  };

  /* ------------------------------------------------------------ stage content by state */
  let stage = null;
  const joinAction = appointment?.actions?.join;
  if (missing) {
    stage = (
      <StageCard icon={AlertTriangle} tone="warn" title={t('consult.errors.notFound')} testId="missing">
        <button className={ghostBtn} onClick={() => navigate(role === 'DOCTOR' ? '/doctor/appointments' : '/patient/appointments')}>
          {t('common.back')}
        </button>
      </StageCard>
    );
  } else if (call.phase === 'idle' || call.phase === 'starting' || call.phase === 'error') {
    const blockerCode = joinAction && !joinAction.allowed ? BLOCKER_CODE[joinAction.blocker] : null;
    const errorCode = call.error?.code ?? blockerCode;
    stage = (
      <StageCard icon={call.phase === 'starting' ? Loader2 : Video} title={appointment ? t('consult.with', { name: otherName }) : t('consult.loading')} testId="prejoin">
        {appointment && (
          <p className="flex items-center justify-center gap-1.5">
            <CalendarClock className="h-4 w-4" /> {fmt(appointment.startAtUtc)}
          </p>
        )}
        {errorCode ? (
          <p className="rounded-xl bg-amber-400/10 px-3 py-2 text-amber-200" role="alert" data-join-error={errorCode}>
            {t(ERROR_KEYS[errorCode] ?? 'consult.errors.generic', { time: fmt(call.error?.details?.opensAt ?? joinAction?.opensAt ?? new Date().toISOString()) })}
          </p>
        ) : (
          <p>{t(role === 'DOCTOR' ? 'consult.prejoin.bodyDoctor' : 'consult.prejoin.body')}</p>
        )}
        {call.mediaIssue && ['DENIED', 'INSECURE', 'UNSUPPORTED'].includes(call.mediaIssue) && (
          <p className="rounded-xl bg-red-500/10 px-3 py-2 text-red-200" role="alert" data-media-issue={call.mediaIssue}>
            {t(MEDIA_KEYS[call.mediaIssue])}
          </p>
        )}
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
          <button className={primaryBtn} disabled={!appointment || call.phase === 'starting' || (joinAction && !joinAction.allowed && !call.error)} onClick={() => call.start()} data-join>
            {call.phase === 'starting' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Video className="h-4 w-4" />}
            {t(call.phase === 'starting' ? 'consult.joining' : role === 'DOCTOR' ? 'consult.prejoin.start' : 'consult.prejoin.join')}
          </button>
          {call.mediaIssue === 'DENIED' && (
            <button className={ghostBtn} onClick={() => call.start({ withoutDevices: true })}>
              {t('consult.media.continueWithout')}
            </button>
          )}
        </div>
        <p className="flex items-center justify-center gap-1.5 text-2xs text-white/60">
          <ShieldCheck className="h-3.5 w-3.5" /> {t('consult.noRecording')}
        </p>
      </StageCard>
    );
  } else if (call.phase === 'ended') {
    stage = (
      <StageCard icon={PhoneOff} title={t('consult.endedTitle')} testId="ended">
        {c?.durationSeconds != null && <p data-duration={c.durationSeconds}>{t('consult.endedBody', { duration: formatClock(c.durationSeconds) })}</p>}
        <button className={primaryBtn} onClick={() => navigate(appointmentPath)}>
          {t('consult.backToAppointment')}
        </button>
        {role === 'DOCTOR' && (
          <button className={ghostBtn} onClick={() => navigate(`${appointmentPath}#follow-up`)} data-book-follow-up>
            {t('consult.bookFollowUp')}
          </button>
        )}
      </StageCard>
    );
  } else if (call.phase === 'left') {
    stage = (
      <StageCard icon={LogOut} title={t('consult.leftTitle')} testId="left">
        <p>{t('consult.leftBody')}</p>
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
          <button className={primaryBtn} onClick={() => call.start()}>
            {t('consult.rejoin')}
          </button>
          <button className={ghostBtn} onClick={() => navigate(appointmentPath)}>
            {t('consult.backToAppointment')}
          </button>
        </div>
      </StageCard>
    );
  } else if (call.phase === 'replaced') {
    stage = (
      <StageCard icon={AlertTriangle} tone="warn" title={t('consult.replacedTitle')} testId="replaced">
        <p>{t('consult.replacedBody')}</p>
        <button className={primaryBtn} onClick={() => call.start()}>
          {t('consult.rejoin')}
        </button>
      </StageCard>
    );
  } else if (!inCall && role === 'PATIENT') {
    stage =
      admission === 'REJECTED' ? (
        <StageCard icon={UserX} tone="warn" title={t('consult.rejected.title')} testId="rejected">
          <p>{t('consult.rejected.body', { name: otherName })}</p>
          <button className={primaryBtn} onClick={() => call.start()}>
            {t('consult.rejected.again')}
          </button>
        </StageCard>
      ) : (
        <StageCard icon={Hourglass} title={t('consult.waiting.title', { name: otherName })} testId="waiting">
          <p>{t('consult.waiting.body', { name: otherName })}</p>
          {role === 'PATIENT' && appointment?.actions?.noShowRefund && (
            <NoShowRefundButton
              className="text-white [&_p]:text-white/70"
              appointmentId={appointment.id}
              action={appointment.actions.noShowRefund}
              onDone={() => {
                call.leave().catch(() => {});
                navigate(appointmentPath);
              }}
            />
          )}
        </StageCard>
      );
  } else if (!inCall && role === 'DOCTOR') {
    if (admission === 'WAITING') {
      stage = (
        <StageCard icon={UserCheck} title={t('consult.lobby.patientWaiting', { name: otherName })} testId="admit">
          <p>{t(call.presence.patient ? 'consult.lobby.patientWaitingBody' : 'consult.lobby.patientAway', { name: otherName })}</p>
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
            <button className={primaryBtn} disabled={busy} onClick={() => doAction(call.admit)} aria-label={t('consult.admitLabel', { name: otherName })} data-admit>
              <UserCheck className="h-4 w-4" /> {t('consult.admit')}
            </button>
            <button className={ghostBtn} disabled={busy} onClick={() => doAction(call.reject)} aria-label={t('consult.rejectLabel', { name: otherName })} data-reject>
              <UserX className="h-4 w-4" /> {t('consult.reject')}
            </button>
          </div>
        </StageCard>
      );
    } else {
      stage = (
        <StageCard icon={Hourglass} title={t(admission === 'REJECTED' ? 'consult.lobby.declinedTitle' : 'consult.lobby.noPatient', { name: otherName })} testId="lobby">
          <p>{t(admission === 'REJECTED' ? 'consult.lobby.declined' : 'consult.lobby.noPatientBody', { name: otherName })}</p>
        </StageCard>
      );
    }
  } else if (inCall && call.failed) {
    stage = (
      <StageCard icon={WifiOff} tone="danger" title={t('consult.failed.title')} testId="failed">
        <p>{t('consult.failed.body')}</p>
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
          <button className={primaryBtn} onClick={call.retryConnection}>
            {t('consult.failed.retry')}
          </button>
          {call.hasVideo && (
            <button className={ghostBtn} onClick={call.switchToAudioOnly}>
              {t('consult.failed.audioOnly')}
            </button>
          )}
        </div>
      </StageCard>
    );
  } else if (inCall && !otherPresent) {
    stage = (
      <StageCard icon={Loader2} title={t('consult.peerAway', { name: otherName })} testId="peer-away">
        <p>{t('consult.peerAwayBody')}</p>
      </StageCard>
    );
  }

  const joined = call.phase === 'active';
  const controls = joined
    ? [
        { key: 'mic', icon: call.mic ? Mic : MicOff, label: t('consult.controls.mic'), ariaLabel: t(call.mic ? 'consult.controls.micOff' : 'consult.controls.micOn'), active: call.mic, disabled: !call.hasAudio, onClick: call.toggleMic },
        { key: 'cam', icon: call.camera ? Video : VideoOff, label: t('consult.controls.camera'), ariaLabel: t(call.camera ? 'consult.controls.cameraOff' : 'consult.controls.cameraOn'), active: call.camera, disabled: !call.hasVideo, onClick: call.toggleCamera },
        { key: 'more', icon: MoreHorizontal, label: t('consult.controls.more'), toggle: false, onClick: () => openPanel('consultation'), mobileOnly: true },
      ]
    : [];
  const canEnd = role === 'DOCTOR' && inCall;
  const hangUp = canEnd ? endCall : () => doAction(call.leave);
  const hangUpLabel = canEnd ? t(confirmEnd ? 'consult.confirmEnd' : 'consult.endCall') : t('consult.leave');
  const hangUpAria = canEnd ? t(confirmEnd ? 'consult.confirmEnd' : 'consult.endCallLabel') : t('consult.leaveLabel');

  return (
    <div className="flex h-[100dvh] flex-col bg-[#061722] text-white lg:bg-bg lg:p-4" data-consultation-role={role} data-phase={call.phase} data-admission={admission ?? 'NONE'}>
      {/* Desktop top bar */}
      <header className="hidden items-center gap-5 rounded-t-2xl bg-[#0B2B3C] px-5 py-3 lg:flex dark:bg-[#07202D]">
        <button onClick={goBack} className="flex items-center gap-2.5" aria-label={t('common.back')}>
          <LogoMark className="h-8 w-8" />
          <span className="text-[17px] font-bold">Fogaan Dawo App</span>
        </button>
        <span className="h-8 w-px bg-white/15" />
        <div className="leading-tight">
          <h1 className="text-sm font-semibold text-white">{otherName ? t('consult.with', { name: otherName }) : t('consult.loading')}</h1>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-white/70">
            <Clock3 className="h-3.5 w-3.5" /> <span className="tabular-nums" data-call-clock>{clock}</span>
          </p>
        </div>
        {inCall && <ConnectionIndicator call={call} inCall={inCall} className="ml-2" />}
        <div className="ml-auto flex items-center gap-2">
          <LanguageSwitcher tone="dark" />
          <ThemeToggle tone="dark" />
          <button onClick={toggleFull} className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/15 hover:bg-white/10" aria-label={t('consult.fullscreen')}>
            {isFull ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 lg:gap-4 lg:rounded-b-2xl lg:bg-[#0B2B3C] lg:p-4 lg:pt-0 dark:lg:bg-[#07202D]">
        {/* Stage */}
        <section className="relative min-h-0 flex-1 overflow-hidden bg-[#0B2B3C] lg:rounded-2xl" aria-label={t('consult.videoStage')}>
          <RemoteVideo
            stream={inCall ? call.remoteStream : null}
            videoOn={call.remoteMedia.video}
            name={otherName}
            label={t('consult.remoteFeed', { name: otherName })}
            placeholder={inCall && otherPresent && !call.failed ? t(call.remoteStream && !call.remoteMedia.video ? 'consult.remoteCameraOff' : 'consult.waitingForVideo', { name: otherName }) : null}
          />

          {stage}

          {/* Mobile overlay header */}
          <div className="absolute inset-x-0 top-0 z-20 flex items-start gap-3 bg-gradient-to-b from-black/60 to-transparent px-4 pb-10 pt-[max(1rem,env(safe-area-inset-top))] lg:hidden">
            <button onClick={goBack} className="-ml-1 rounded-full p-1.5 hover:bg-white/10" aria-label={t('common.back')}>
              <ChevronLeft className="h-6 w-6" />
            </button>
            <div className="min-w-0 leading-tight">
              <h1 className="truncate text-[15px] font-bold text-white">{otherName}</h1>
              <p className="text-xs tabular-nums text-white/80">{clock}</p>
            </div>
            {inCall && <ConnectionIndicator call={call} inCall={inCall} className="ml-auto mr-[104px] mt-1" />}
          </div>

          {joined && <SelfView stream={call.localStream} cameraOn={call.camera} name={selfName} className="absolute right-3 top-[max(0.75rem,env(safe-area-inset-top))] z-20 h-36 w-24 lg:right-4 lg:top-4 lg:h-[150px] lg:w-[220px]" />}

          {joined && !call.mic && call.hasAudio && (
            <span className="absolute left-4 top-20 z-20 flex items-center gap-1.5 rounded-full bg-red-500/90 px-3 py-1 text-xs font-semibold lg:top-4">
              <MicOff className="h-3.5 w-3.5" /> {t('consult.muted')}
            </span>
          )}
          {inCall && otherPresent && !call.remoteMedia.audio && (
            <span className="absolute left-4 top-28 z-20 flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-1 text-xs font-semibold lg:top-14">
              <MicOff className="h-3.5 w-3.5" /> {t('consult.remoteMuted', { name: otherName })}
            </span>
          )}
          {joined && call.signalState === 'reconnecting' && (
            <p className="absolute inset-x-4 top-20 z-20 mx-auto max-w-md rounded-xl bg-amber-500/90 px-3 py-2 text-center text-xs font-semibold text-[#061722] lg:top-4" role="status">
              {t('consult.signalLost')}
            </p>
          )}

          {joined && (
            <>
              {/* Desktop control bar */}
              <div className="absolute inset-x-0 bottom-0 z-20 hidden justify-center pb-4 lg:flex">
                <div className="flex items-center gap-1 rounded-2xl border border-white/10 bg-[#0B2B3C]/85 px-3 py-2 backdrop-blur-md">
                  {controls
                    .filter((ctl) => !ctl.mobileOnly)
                    .map(({ key, mobileOnly, ...ctl }) => (
                      <CallControl key={key} {...ctl} />
                    ))}
                  <button onClick={hangUp} disabled={busy} aria-label={hangUpAria} data-hangup={canEnd ? 'end' : 'leave'} className="ml-3 flex h-11 items-center gap-2 rounded-xl bg-red-500 px-5 text-sm font-bold text-white shadow-[0_6px_18px_rgb(239_68_68/0.4)] hover:bg-red-600 disabled:opacity-60">
                    <Phone className="h-4 w-4 rotate-[135deg] fill-current" /> {hangUpLabel}
                  </button>
                </div>
              </div>

              {/* Mobile round controls */}
              <div className="absolute inset-x-0 bottom-0 z-20 flex items-center justify-center gap-3 bg-gradient-to-t from-black/70 to-transparent px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-14 lg:hidden">
                {controls.map(({ key, mobileOnly, ...ctl }) => (
                  <CallControl key={key} round {...ctl} />
                ))}
                <button onClick={hangUp} disabled={busy} className={cn('flex h-14 items-center justify-center rounded-full bg-red-500 shadow-[0_6px_18px_rgb(239_68_68/0.5)]', confirmEnd ? 'px-4 text-xs font-bold' : 'w-14')} aria-label={hangUpAria}>
                  {confirmEnd ? hangUpLabel : <Phone className="h-6 w-6 rotate-[135deg] fill-current" />}
                </button>
              </div>
            </>
          )}
        </section>

        {/* Desktop side panel */}
        <div className="hidden w-[360px] shrink-0 overflow-hidden rounded-2xl text-ink lg:block xl:w-[400px]">
          <ConsultationPanel consult={c} role={role} tab={tab} setTab={setTab} onSaveNote={call.saveNote} />
        </div>
      </div>

      {/* Mobile bottom sheet */}
      {sheetOpen && (
        <div className="fixed inset-0 z-50 flex items-end lg:hidden" role="dialog" aria-modal="true">
          <button aria-hidden="true" tabIndex={-1} className="absolute inset-0 bg-black/50" onClick={() => setSheetOpen(false)} />
          <div className="relative h-[78dvh] w-full animate-fade-up overflow-hidden rounded-t-3xl text-ink">
            <ConsultationPanel consult={c} role={role} tab={tab} setTab={setTab} onClose={() => setSheetOpen(false)} onSaveNote={call.saveNote} />
          </div>
        </div>
      )}
      <span className="sr-only" aria-live="polite">
        {inCall && otherPresent ? t('consult.connection.inCall', { name: otherName }) : ''}
      </span>
    </div>
  );
}
