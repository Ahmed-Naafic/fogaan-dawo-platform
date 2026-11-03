import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChevronLeft,
  Clock3,
  Maximize,
  MessageSquareText,
  Mic,
  MicOff,
  Minimize,
  MoreHorizontal,
  Phone,
  ScreenShare,
  ScreenShareOff,
  SignalHigh,
  Video,
  VideoOff,
} from 'lucide-react';
import { LogoMark } from '@/components/shared/Logo';
import LanguageSwitcher from '@/components/shared/LanguageSwitcher';
import ThemeToggle from '@/components/shared/ThemeToggle';
import { useToast } from '@/components/ui/Toast';
import ConsultationPanel from '@/features/consultations/components/ConsultationPanel';
import useCallTimer from '@/hooks/useCallTimer';
import { useI18n } from '@/lib/i18n';
import { getConsultation } from '@/services';
import CallControl from '../components/CallControl';
import SelfView from '../components/SelfView';
import doctorFeed from '@/assets/images/consult-doctor.jpg';
import doctorFeedMobile from '@/assets/images/consult-doctor-mobile.jpg';

export default function VideoConsultationPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const notify = useToast();
  const consult = getConsultation();
  const clock = useCallTimer(consult.startedSecondsAgo);
  const [mic, setMic] = useState(true);
  const [cam, setCam] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [tab, setTab] = useState('consultation');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [isFull, setIsFull] = useState(false);

  useEffect(() => {
    const onChange = () => setIsFull(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFull = () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  };
  const endCall = () => {
    notify(t('consult.ended'), 'success');
    navigate('/patient');
  };
  const openPanel = (which) => {
    setTab(which);
    setSheetOpen(true);
  };

  const controls = [
    { key: 'mic', icon: mic ? Mic : MicOff, label: t('consult.controls.mic'), active: mic, onClick: () => setMic((v) => !v) },
    { key: 'cam', icon: cam ? Video : VideoOff, label: t('consult.controls.camera'), active: cam, onClick: () => setCam((v) => !v) },
    { key: 'share', icon: sharing ? ScreenShareOff : ScreenShare, label: t('consult.controls.share'), active: !sharing, onClick: () => setSharing((v) => !v) },
    { key: 'chat', icon: MessageSquareText, label: t('consult.controls.chat'), onClick: () => openPanel('chat') },
    { key: 'more', icon: MoreHorizontal, label: t('consult.controls.more'), onClick: () => openPanel('consultation') },
  ];

  return (
    <div className="flex h-[100dvh] flex-col bg-[#061722] text-white lg:bg-bg lg:p-4">
      {/* Desktop top bar */}
      <header className="hidden items-center gap-5 rounded-t-2xl bg-[#0B2B3C] px-5 py-3 lg:flex dark:bg-[#07202D]">
        <button onClick={() => navigate('/patient')} className="flex items-center gap-2.5" aria-label={t('common.back')}>
          <LogoMark className="h-8 w-8" />
          <span className="text-[17px] font-bold">Fogaan Dawo App</span>
        </button>
        <span className="h-8 w-px bg-white/15" />
        <div className="leading-tight">
          <p className="text-sm font-semibold">{t('consult.with', { name: consult.doctor.name })}</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-white/70">
            <Clock3 className="h-3.5 w-3.5" /> <span className="tabular-nums">{clock}</span>
          </p>
        </div>
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
        <section className="relative min-h-0 flex-1 overflow-hidden lg:rounded-2xl" aria-label={t('consult.videoStage')}>
          <picture>
            <source media="(min-width: 1024px)" srcSet={doctorFeed} />
            <img src={doctorFeedMobile} alt={t('consult.remoteFeed', { name: consult.doctor.name })} className="absolute inset-0 h-full w-full object-cover object-[50%_25%]" />
          </picture>
          {sharing && (
            <div className="absolute inset-0 flex items-center justify-center bg-[#061722]/80 backdrop-blur-sm">
              <p className="flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2.5 text-sm font-semibold">
                <ScreenShare className="h-4 w-4" /> {t('consult.sharing')}
              </p>
            </div>
          )}

          {/* Mobile overlay header */}
          <div className="absolute inset-x-0 top-0 flex items-start gap-3 bg-gradient-to-b from-black/60 to-transparent px-4 pb-10 pt-[max(1rem,env(safe-area-inset-top))] lg:hidden">
            <button onClick={() => navigate('/patient')} className="-ml-1 rounded-full p-1.5 hover:bg-white/10" aria-label={t('common.back')}>
              <ChevronLeft className="h-6 w-6" />
            </button>
            <div className="leading-tight">
              <p className="text-[15px] font-bold">{consult.doctor.name}</p>
              <p className="text-xs tabular-nums text-white/80">{clock}</p>
            </div>
            <SignalHigh className="ml-auto mr-[104px] mt-1 h-5 w-5 text-emerald-400" aria-label={t('consult.goodConnection')} />
          </div>

          <SelfView cameraOn={cam} name={consult.patient.name} className="absolute right-3 top-[max(0.75rem,env(safe-area-inset-top))] h-36 w-24 lg:right-4 lg:top-4 lg:h-[150px] lg:w-[220px]" />

          {!mic && (
            <span className="absolute left-4 top-20 flex items-center gap-1.5 rounded-full bg-red-500/90 px-3 py-1 text-xs font-semibold lg:top-4">
              <MicOff className="h-3.5 w-3.5" /> {t('consult.muted')}
            </span>
          )}

          {/* Desktop control bar */}
          <div className="absolute inset-x-0 bottom-0 hidden justify-center pb-4 lg:flex">
            <div className="flex items-center gap-1 rounded-2xl border border-white/10 bg-[#0B2B3C]/85 px-3 py-2 backdrop-blur-md">
              {controls.map(({ key, ...c }) => (
                <CallControl key={key} {...c} />
              ))}
              <button onClick={endCall} className="ml-3 flex h-11 items-center gap-2 rounded-xl bg-red-500 px-5 text-sm font-bold text-white shadow-[0_6px_18px_rgb(239_68_68/0.4)] hover:bg-red-600">
                <Phone className="h-4 w-4 rotate-[135deg] fill-current" /> {t('consult.endCall')}
              </button>
            </div>
          </div>

          {/* Mobile round controls */}
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-3 bg-gradient-to-t from-black/70 to-transparent px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-14 lg:hidden">
            {controls
              .filter((c) => c.key !== 'share')
              .map(({ key, ...c }) => (
                <CallControl key={key} round {...c} />
              ))}
            <button onClick={endCall} className="flex h-14 w-14 items-center justify-center rounded-full bg-red-500 shadow-[0_6px_18px_rgb(239_68_68/0.5)]" aria-label={t('consult.endCall')}>
              <Phone className="h-6 w-6 rotate-[135deg] fill-current" />
            </button>
          </div>
        </section>

        {/* Desktop side panel */}
        <div className="hidden w-[360px] shrink-0 overflow-hidden rounded-2xl text-ink lg:block xl:w-[400px]">
          <ConsultationPanel consult={consult} tab={tab} setTab={setTab} />
        </div>
      </div>

      {/* Mobile bottom sheet */}
      {sheetOpen && (
        <div className="fixed inset-0 z-50 flex items-end lg:hidden" role="dialog" aria-modal="true">
          <button aria-hidden="true" tabIndex={-1} className="absolute inset-0 bg-black/50" onClick={() => setSheetOpen(false)} />
          <div className="relative h-[78dvh] w-full animate-fade-up overflow-hidden rounded-t-3xl text-ink">
            <ConsultationPanel consult={consult} tab={tab} setTab={setTab} onClose={() => setSheetOpen(false)} />
          </div>
        </div>
      )}
    </div>
  );
}
