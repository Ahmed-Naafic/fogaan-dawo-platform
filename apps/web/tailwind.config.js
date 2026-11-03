/** @type {import('tailwindcss').Config} */
// Colors resolve to CSS variables defined in src/styles/tokens.css,
// so every utility automatically follows the active light/dark theme.
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: token('bg'),
        surface: token('surface'),
        subtle: token('subtle'),
        line: token('line'),
        ink: token('ink'),
        muted: token('muted'),
        primary: {
          DEFAULT: token('primary'),
          hover: token('primary-hover'),
          fg: token('primary-fg'),
          soft: token('primary-soft'),
        },
        sidebar: {
          DEFAULT: token('sidebar'),
          active: token('sidebar-active'),
          ink: token('sidebar-ink'),
          line: token('sidebar-line'),
        },
        brand: {
          navy: '#102F46',
          teal: '#159A91',
          gold: '#D5A64A',
          white: '#F5F7FA',
          charcoal: '#202B36',
        },
        success: token('success'),
        danger: token('danger'),
        warning: token('warning'),
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'Inter', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      borderRadius: {
        xl: '0.875rem',
        '2xl': '1.125rem',
        '3xl': '1.5rem',
      },
      boxShadow: {
        card: 'var(--shadow-card)',
        float: 'var(--shadow-float)',
        glow: 'var(--shadow-glow)',
      },
      maxWidth: {
        site: '1240px',
      },
      keyframes: {
        wave: {
          '0%, 60%, 100%': { transform: 'rotate(0deg)' },
          '10%, 30%': { transform: 'rotate(14deg)' },
          '20%': { transform: 'rotate(-8deg)' },
          '40%': { transform: 'rotate(-4deg)' },
          '50%': { transform: 'rotate(10deg)' },
        },
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.5s ease-out both',
      },
    },
  },
  plugins: [],
};
