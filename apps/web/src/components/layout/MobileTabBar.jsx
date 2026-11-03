import { NavLink } from 'react-router-dom';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/cn';

const itemClass = (active) =>
  cn('flex flex-1 flex-col items-center gap-1 py-2 text-[10.5px] font-semibold transition-colors', active ? 'text-primary' : 'text-muted');

export default function MobileTabBar({ items, onMore }) {
  const { t } = useI18n();
  return (
    <nav
      aria-label={t('nav.main')}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 px-2 backdrop-blur-lg pb-safe lg:hidden"
    >
      <div className="mx-auto flex max-w-md">
        {items.map(({ to, label, icon: Icon, end, more }) =>
          more ? (
            <button key={label} type="button" onClick={onMore} className={itemClass(false)}>
              <Icon className="h-[22px] w-[22px]" strokeWidth={1.9} />
              {t(label)}
            </button>
          ) : (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => itemClass(isActive)}>
              {({ isActive }) => (
                <>
                  <Icon className="h-[22px] w-[22px]" strokeWidth={isActive ? 2.3 : 1.9} fill={isActive ? 'currentColor' : 'none'} fillOpacity={0.15} />
                  {t(label)}
                </>
              )}
            </NavLink>
          ),
        )}
      </div>
    </nav>
  );
}
