import { useEffect, useRef } from 'react';
import Avatar from '@/components/ui/Avatar';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/cn';

/** Local camera preview (picture-in-picture, mirrored). Shows the avatar when the camera is off or absent. */
export default function SelfView({ stream, cameraOn, name, className }) {
  const { t } = useI18n();
  const ref = useRef(null);
  const showVideo = Boolean(stream?.getVideoTracks().length) && cameraOn;
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream ?? null;
  }, [stream, showVideo]);
  return (
    <div className={cn('overflow-hidden rounded-2xl border-2 border-white/80 bg-[#0E2533] shadow-float', className)} data-self-view>
      {showVideo ? (
        <video ref={ref} autoPlay playsInline muted aria-label={t('consult.selfView')} className="h-full w-full -scale-x-100 object-cover" />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 text-white/80">
          <Avatar name={name} size="md" className="bg-white/10 text-white" />
          <span className="text-2xs font-semibold">{t('consult.cameraOff')}</span>
        </div>
      )}
    </div>
  );
}
