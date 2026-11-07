import { useState } from 'react';
import { cn } from '@/lib/cn';

const sizes = {
  xs: 'h-7 w-7 text-2xs',
  sm: 'h-9 w-9 text-xs',
  md: 'h-11 w-11 text-sm',
  lg: 'h-14 w-14 text-base',
  xl: 'h-[72px] w-[72px] text-lg',
};

function initials(name = '') {
  return name
    .replace(/^Dr\.?\s+/i, '')
    .split(' ')
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();
}

/** Circular portrait with initials fallback if the image fails to load. */
export default function Avatar({ src, name, size = 'md', ring = false, className }) {
  const [failed, setFailed] = useState(false);
  return (
    <span
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary-soft font-bold text-primary',
        ring && 'ring-2 ring-surface shadow-card',
        sizes[size],
        className,
      )}
    >
      {src && !failed ? (
        <img src={src} alt={name ?? ''} className="h-full w-full object-cover" loading="lazy" onError={() => setFailed(true)} />
      ) : (
        <span aria-hidden="true">{initials(name)}</span>
      )}
    </span>
  );
}
