import Avatar from '@/components/ui/Avatar';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/cn';
import patientFeed from '@/assets/images/consult-patient.jpg';

/** Local camera preview (picture-in-picture). */
export default function SelfView({ cameraOn, name, className }) {
  const { t } = useI18n();
  return (
    <div className={cn('overflow-hidden rounded-2xl border-2 border-white/80 bg-[#0E2533] shadow-float', className)}>
      {cameraOn ? (
        <img src={patientFeed} alt={t('consult.selfView')} className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 text-white/80">
          <Avatar name={name} size="md" className="bg-white/10 text-white" />
          <span className="text-2xs font-semibold">{t('consult.cameraOff')}</span>
        </div>
      )}
    </div>
  );
}
