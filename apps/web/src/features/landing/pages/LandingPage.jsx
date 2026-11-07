import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  ArrowRight,
  BadgeCheck,
  CalendarCheck2,
  ClipboardList,
  CreditCard,
  FileHeart,
  Globe2,
  HeartHandshake,
  Languages,
  Lock,
  Mic,
  Phone,
  Search,
  ShieldCheck,
  Smartphone,
  Star,
  UserRound,
  Video,
} from 'lucide-react';
import PublicHeader from '@/components/layout/PublicHeader';
import Button from '@/components/ui/Button';
import IconTile from '@/components/ui/IconTile';
import Logo from '@/components/shared/Logo';
import { getSpecialtyIcon } from '@/components/shared/SpecialtyIcon';
import { useTheme } from '@/lib/theme';
import { useI18n } from '@/lib/i18n';
import { getPlatformStats, getSpecialties } from '@/services';
import { searchDoctors } from '@/features/doctors/services/doctorDirectoryApi';
import { DoctorCard } from '@/features/doctors/components/DoctorCard';
import BookingSheet from '@/features/appointments/components/BookingSheet';
import heroLight from '@/assets/images/hero-light.jpg';
import heroDark from '@/assets/images/hero-dark.jpg';
import consultDoctor from '@/assets/images/consult-doctor.jpg';

const FEATURE_CHIPS = [
  { icon: Video, label: 'landing.features.video' },
  { icon: ClipboardList, label: 'landing.features.prescription' },
  { icon: CreditCard, label: 'landing.features.payment' },
  { icon: FileHeart, label: 'landing.features.history' },
];

function HeroVisual() {
  const { isDark } = useTheme();
  const { t } = useI18n();
  return (
    <div className="relative mx-auto w-full max-w-[520px] lg:mr-0">
      <div className="relative ml-auto aspect-[480/556] w-[86%] sm:w-[78%] lg:w-[88%]">
        <img
          src={isDark ? heroDark : heroLight}
          alt={t('landing.hero.imageAlt')}
          className="hero-photo h-full w-full object-cover"
          fetchpriority="high"
        />
        {/* Live call preview — overlays the frame area of the photograph */}
        <div className="absolute left-[14%] top-[63.5%] h-[35%] w-[62%] overflow-hidden rounded-2xl border-[3px] border-white bg-slate-200 shadow-float dark:border-white/80">
          <img src={consultDoctor} alt="" className="h-full w-full object-cover object-[60%_20%]" />
          <div className="absolute inset-x-0 bottom-2.5 flex justify-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-700/85 text-white backdrop-blur">
              <Video className="h-4 w-4" />
            </span>
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-700/85 text-white backdrop-blur">
              <Mic className="h-4 w-4" />
            </span>
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-red-500 text-white">
              <Phone className="h-4 w-4 rotate-[135deg] fill-current" />
            </span>
          </div>
        </div>
      </div>

      {/* Floating feature list */}
      <ul className="absolute left-0 top-[24%] w-[46%] max-w-[220px] space-y-2 rounded-2xl border border-line bg-surface/90 p-2.5 shadow-float backdrop-blur-md sm:w-[44%] sm:p-3 dark:bg-surface/80">
        {FEATURE_CHIPS.map(({ icon: Icon, label }) => (
          <li key={label} className="flex items-center gap-2.5 rounded-xl bg-subtle/80 py-1.5 pl-1.5 pr-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary sm:h-8 sm:w-8">
              <Icon className="h-4 w-4" />
            </span>
            <span className="truncate text-2xs font-semibold sm:text-xs">{t(label)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Hero() {
  const { t } = useI18n();
  const stats = getPlatformStats();
  const items = [
    { icon: UserRound, value: stats.doctors, label: 'landing.stats.doctors' },
    { icon: CalendarCheck2, value: stats.consultations, label: 'landing.stats.consultations' },
    { icon: Star, value: stats.satisfaction, label: 'landing.stats.satisfaction' },
  ];
  return (
    <section id="home" className="relative scroll-mt-24 overflow-hidden">
      <div className="mx-auto grid max-w-site items-center gap-10 px-4 pb-10 pt-6 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:gap-6 lg:pb-12 lg:pt-10">
        <div className="animate-fade-up">
          <span className="inline-flex items-center gap-2 rounded-full bg-primary-soft px-3 py-1.5 text-xs font-semibold text-ink">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-fg">
              <HeartHandshake className="h-3 w-3" />
            </span>
            {t('landing.hero.badge')}
          </span>
          <h1 className="mt-5 text-[40px] font-extrabold leading-[1.06] tracking-[-0.02em] sm:text-[56px] lg:text-[62px]">
            {t('landing.hero.titleLine1')}
            <br />
            {t('landing.hero.titleLine2')}
          </h1>
          <p className="mt-5 max-w-[30rem] text-base leading-relaxed text-muted sm:text-lg">{t('landing.hero.subtitle')}</p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Button to="/doctors" size="lg" className="px-7">
              {t('landing.hero.book')} <ArrowRight className="h-4 w-4" />
            </Button>
            <Button to="/doctors" size="lg" variant="outline" className="px-7">
              <Search className="h-4 w-4" /> {t('landing.hero.find')}
            </Button>
          </div>
          <dl className="mt-10 grid grid-cols-3 gap-3 sm:gap-6">
            {items.map(({ icon: Icon, value, label }, i) => (
              <div key={label} className={i > 0 ? 'border-l border-line pl-3 sm:pl-6' : ''}>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
                    <Icon className="h-5 w-5" />
                  </span>
                  <div>
                    <dt className="sr-only">{t(label)}</dt>
                    <dd className="text-lg font-extrabold leading-none sm:text-xl">{value}</dd>
                    <dd className="mt-1 text-2xs text-muted sm:text-xs">{t(label)}</dd>
                  </div>
                </div>
              </div>
            ))}
          </dl>
        </div>
        <HeroVisual />
      </div>
    </section>
  );
}

function SectionTitle({ eyebrow, title, subtitle, center = true }) {
  return (
    <div className={center ? 'mx-auto max-w-2xl text-center' : 'max-w-2xl'}>
      <p className="text-xs font-bold uppercase tracking-[0.14em] text-primary">{eyebrow}</p>
      <h2 className="mt-2.5 text-[28px] font-extrabold leading-tight sm:text-4xl">{title}</h2>
      {subtitle && <p className="mt-3 text-base text-muted">{subtitle}</p>}
    </div>
  );
}

function Specialties() {
  const { t } = useI18n();
  const navigate = useNavigate();
  return (
    <section id="specialties" className="scroll-mt-24 pb-16 pt-8 sm:pb-20 sm:pt-12">
      <div className="mx-auto max-w-site px-4 sm:px-6">
        <SectionTitle eyebrow={t('landing.specialties.eyebrow')} title={t('landing.specialties.title')} subtitle={t('landing.specialties.subtitle')} />
        <div className="mt-10 grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4">
          {getSpecialties().map((s) => (
            <button
              key={s.key}
              onClick={() => navigate(`/doctors?specialty=${s.key}`)}
              className="card group flex flex-col items-start gap-4 p-4 text-left transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-float sm:p-5"
            >
              <IconTile icon={getSpecialtyIcon(s.icon)} tone={s.tone} />
              <div>
                <p className="font-bold">{t(`specialty.${s.key}`)}</p>
                <p className="mt-0.5 text-xs text-muted">{t('landing.specialties.count', { count: s.doctors })}</p>
              </div>
              <span className="mt-auto inline-flex items-center gap-1 text-xs font-semibold text-primary opacity-80 group-hover:opacity-100">
                {t('landing.specialties.browse')} <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
              </span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function FeaturedDoctors() {
  const { t } = useI18n();
  const [favorites, setFavorites] = useState(() => new Set());
  const [booking, setBooking] = useState(null);
  const [doctors, setDoctors] = useState(null);
  useEffect(() => {
    let live = true;
    searchDoctors({ sort: 'rating', pageSize: 3 })
      .then((d) => live && setDoctors(d.items))
      .catch(() => live && setDoctors([]));
    return () => {
      live = false;
    };
  }, []);
  const toggle = (id) =>
    setFavorites((f) => {
      const n = new Set(f);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  return (
    <section id="doctors" className="scroll-mt-24 bg-surface py-16 sm:py-20 dark:bg-[#071A26]">
      <div className="mx-auto max-w-site px-4 sm:px-6">
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
          <SectionTitle center={false} eyebrow={t('landing.doctors.eyebrow')} title={t('landing.doctors.title')} subtitle={t('landing.doctors.subtitle')} />
          <Button to="/doctors" variant="outline">
            {t('landing.doctors.viewAll')} <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {doctors === null
            ? Array.from({ length: 3 }, (_, i) => <div key={i} className="card h-80 animate-pulse" aria-hidden="true" />)
            : doctors.map((d) => <DoctorCard key={d.id} doctor={d} profileHref={`/doctors/${d.id}`} favorite={favorites.has(d.id)} onToggleFavorite={() => toggle(d.id)} onBook={setBooking} />)}
          {doctors?.length === 0 && <p className="card col-span-full px-6 py-10 text-center text-sm text-muted">{t('landing.doctors.empty')}</p>}
        </div>
      </div>
      {booking && <BookingSheet doctor={booking} onClose={() => setBooking(null)} />}
    </section>
  );
}

function HowItWorks() {
  const { t } = useI18n();
  const steps = [
    { icon: Search, title: 'landing.how.step1Title', body: 'landing.how.step1Body' },
    { icon: CalendarCheck2, title: 'landing.how.step2Title', body: 'landing.how.step2Body' },
    { icon: Video, title: 'landing.how.step3Title', body: 'landing.how.step3Body' },
  ];
  return (
    <section id="how-it-works" className="scroll-mt-24 py-16 sm:py-20">
      <div className="mx-auto max-w-site px-4 sm:px-6">
        <SectionTitle eyebrow={t('landing.how.eyebrow')} title={t('landing.how.title')} />
        <ol className="relative mt-12 grid gap-5 md:grid-cols-3">
          <span className="absolute left-[16%] right-[16%] top-8 hidden h-px border-t-2 border-dashed border-primary/30 md:block" aria-hidden="true" />
          {steps.map(({ icon: Icon, title, body }, i) => (
            <li key={title} className="card relative p-6 text-center">
              <span className="relative mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary text-primary-fg shadow-glow">
                <Icon className="h-7 w-7" />
                <span className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-brand-gold text-2xs font-extrabold text-brand-navy ring-4 ring-surface">
                  {i + 1}
                </span>
              </span>
              <h3 className="mt-5 text-lg font-bold">{t(title)}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{t(body)}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function About() {
  const { t } = useI18n();
  const points = [
    { icon: ShieldCheck, label: 'landing.about.point1' },
    { icon: Languages, label: 'landing.about.point2' },
    { icon: Lock, label: 'landing.about.point3' },
    { icon: Smartphone, label: 'landing.about.point4' },
  ];
  return (
    <section id="about" className="scroll-mt-24 px-4 pb-16 sm:px-6 sm:pb-20">
      <div className="relative mx-auto max-w-site overflow-hidden rounded-3xl bg-brand-navy px-6 py-12 text-white sm:px-12 sm:py-16 dark:border dark:border-line dark:bg-[#082030]">
        <div className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-brand-teal/30 blur-3xl" aria-hidden="true" />
        <div className="pointer-events-none absolute -bottom-32 left-1/3 h-72 w-72 rounded-full bg-brand-gold/10 blur-3xl" aria-hidden="true" />
        <div className="relative grid items-center gap-10 lg:grid-cols-2">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-teal-300">{t('landing.about.eyebrow')}</p>
            <h2 className="mt-2.5 text-[28px] font-extrabold leading-tight text-white sm:text-4xl">{t('landing.about.title')}</h2>
            <p className="mt-4 max-w-lg text-base leading-relaxed text-white/75">{t('landing.about.body')}</p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button to="/register" size="lg" className="bg-[#34E2C6] text-[#042426] hover:bg-[#5CECD4]">
                {t('landing.about.cta')} <ArrowRight className="h-4 w-4" />
              </Button>
              <Button to="/register?role=doctor" size="lg" variant="secondary" className="border-white/25 bg-transparent text-white hover:bg-white/10">
                <BadgeCheck className="h-4 w-4" /> {t('landing.about.ctaDoctor')}
              </Button>
            </div>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2">
            {points.map(({ icon: Icon, label }) => (
              <li key={label} className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.05] p-4 backdrop-blur">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#34E2C6]/15 text-[#5CECD4]">
                  <Icon className="h-5 w-5" />
                </span>
                <span className="text-sm font-medium leading-snug text-white/90">{t(label)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  const { t } = useI18n();
  return (
    <footer className="border-t border-line bg-surface dark:bg-[#071A26]">
      <div className="mx-auto flex max-w-site flex-col items-start justify-between gap-6 px-4 py-10 sm:flex-row sm:items-center sm:px-6">
        <div>
          <Logo />
          <p className="mt-2 flex items-center gap-1.5 text-sm text-muted">
            <Globe2 className="h-4 w-4" /> {t('brand.tagline')}
          </p>
        </div>
        <p className="text-xs text-muted">© 2026 Fogaan Dawo App. {t('landing.footer.rights')}</p>
      </div>
    </footer>
  );
}

export default function LandingPage() {
  return (
    <div className="hero-bg min-h-screen">
      <PublicHeader />
      <main>
        <Hero />
        <Specialties />
        <FeaturedDoctors />
        <HowItWorks />
        <About />
      </main>
      <Footer />
    </div>
  );
}
