import { useEffect, useRef } from 'react';
import Avatar from '@/components/ui/Avatar';

/**
 * The other participant: video when they send it, otherwise their avatar. The <video> element stays
 * mounted (hidden) so their audio keeps playing while their camera is off.
 */
export default function RemoteVideo({ stream, videoOn, name, label, placeholder }) {
  const ref = useRef(null);
  const hasVideo = Boolean(stream?.getVideoTracks().some((t) => t.readyState === 'live')) && videoOn;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.srcObject !== stream) el.srcObject = stream ?? null;
    if (stream) el.play?.().catch(() => {});
  }, [stream]);
  return (
    <div className="absolute inset-0 bg-[#0B2B3C]">
      <video
        ref={ref}
        autoPlay
        playsInline
        aria-label={label}
        data-remote-video={hasVideo ? 'on' : 'off'}
        className={hasVideo ? 'absolute inset-0 h-full w-full object-cover' : 'pointer-events-none absolute h-px w-px opacity-0'}
      />
      {!hasVideo && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-gradient-to-b from-[#0B2B3C] to-[#061722] px-6 text-center">
          <Avatar name={name} size="xl" className="bg-white/10 text-white ring-4 ring-white/10" />
          {placeholder && <p className="text-sm font-semibold text-white/80">{placeholder}</p>}
        </div>
      )}
    </div>
  );
}
