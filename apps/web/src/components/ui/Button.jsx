import { Link } from 'react-router';
import { cn } from '@/lib/cn';

const variants = {
  primary: 'bg-primary text-primary-fg hover:bg-primary-hover shadow-glow',
  outline: 'border border-primary/70 text-primary bg-surface hover:bg-primary-soft',
  secondary: 'border border-line bg-surface text-ink hover:bg-subtle',
  soft: 'bg-primary-soft text-primary hover:bg-primary/15',
  ghost: 'text-muted hover:text-ink hover:bg-subtle',
  danger: 'bg-danger text-white hover:bg-danger/90 shadow-[0_6px_18px_rgb(229_57_53/0.35)]',
};

const sizes = {
  xs: 'h-7 px-2.5 text-2xs gap-1 rounded-lg',
  sm: 'h-9 px-3.5 text-xs gap-1.5 rounded-lg',
  md: 'h-11 px-5 text-sm gap-2 rounded-xl',
  lg: 'h-12 px-6 text-[15px] gap-2 rounded-xl',
  icon: 'h-10 w-10 rounded-xl',
};

/** Renders a <Link> when `to` is given, otherwise a <button>. */
export default function Button({ variant = 'primary', size = 'md', to, className, children, type = 'button', ...props }) {
  const classes = cn(
    'inline-flex shrink-0 items-center justify-center font-semibold transition-colors duration-150 disabled:pointer-events-none disabled:opacity-50',
    variants[variant],
    sizes[size],
    className,
  );
  if (to) {
    return (
      <Link to={to} className={classes} {...props}>
        {children}
      </Link>
    );
  }
  return (
    <button type={type} className={classes} {...props}>
      {children}
    </button>
  );
}
