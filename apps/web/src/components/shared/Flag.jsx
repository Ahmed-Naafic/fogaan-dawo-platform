/** Tiny inline flags for the language switcher (no external assets). */
export default function Flag({ code, className = 'h-3.5 w-5' }) {
  if (code === 'so') {
    return (
      <svg viewBox="0 0 30 20" className={`${className} rounded-[2px]`} aria-hidden="true">
        <rect width="30" height="20" fill="#4189DD" />
        <path d="M15 5.2l1.18 3.62h3.8l-3.08 2.24 1.18 3.62L15 12.44l-3.08 2.24 1.18-3.62-3.08-2.24h3.8z" fill="#fff" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 60 30" className={`${className} rounded-[2px]`} aria-hidden="true">
      <clipPath id="gb-c">
        <path d="M0,0 v30 h60 v-30 z" />
      </clipPath>
      <g clipPath="url(#gb-c)">
        <path d="M0,0 v30 h60 v-30 z" fill="#012169" />
        <path d="M0,0 L60,30 M60,0 L0,30" stroke="#fff" strokeWidth="6" />
        <path d="M0,0 L60,30 M60,0 L0,30" stroke="#C8102E" strokeWidth="2.5" />
        <path d="M30,0 v30 M0,15 h60" stroke="#fff" strokeWidth="10" />
        <path d="M30,0 v30 M0,15 h60" stroke="#C8102E" strokeWidth="6" />
      </g>
    </svg>
  );
}
