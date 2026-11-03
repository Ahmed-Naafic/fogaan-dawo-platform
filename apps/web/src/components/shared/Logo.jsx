import { useId } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/cn';

/** Heart + ECG pulse mark from the approved references. */
export function LogoMark({ className = 'h-9 w-9' }) {
  // Unique per instance: a gradient defined inside a hidden SVG would otherwise break visible copies.
  const gid = `fd-heart-${useId().replace(/:/g, '')}`;
  return (
    <svg viewBox="0 0 48 44" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#3FE0C5" />
          <stop offset="100%" stopColor="#139388" />
        </linearGradient>
      </defs>
      <path
        d="M24 42C21.6 40.2 2 27.4 2 14.2 2 7.4 7.2 2 13.6 2c4.4 0 8 2.4 10.4 6 2.4-3.6 6-6 10.4-6C40.8 2 46 7.4 46 14.2 46 27.4 26.4 40.2 24 42Z"
        fill={`url(#${gid})`}
      />
      <path
        d="M8 21.5h8.5l3-6 4.5 12 3.6-8.5 2 2.5H40"
        fill="none"
        stroke="#0B2B3C"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * variant: 'default' (ink text) | 'light' (white text, for navy surfaces)
 * stacked: two-line wordmark used in sidebars ("Fogaan Dawo" / "App").
 */
export default function Logo({ to = '/', variant = 'default', stacked = false, className, markClassName }) {
  const textColor = variant === 'light' ? 'text-white' : 'text-ink';
  return (
    <Link to={to} className={cn('inline-flex items-center gap-2.5', className)} aria-label="Fogaan Dawo App — home">
      <LogoMark className={markClassName ?? (stacked ? 'h-9 w-9' : 'h-8 w-8')} />
      {stacked ? (
        <span className={cn('text-[15px] font-bold leading-[1.15]', textColor)}>
          Fogaan Dawo
          <span className="block font-semibold">App</span>
        </span>
      ) : (
        <span className={cn('whitespace-nowrap text-base font-bold tracking-tight sm:text-lg', textColor)}>Fogaan Dawo App</span>
      )}
    </Link>
  );
}
