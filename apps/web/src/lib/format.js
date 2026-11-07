export function greetingKey(date = new Date()) {
  const h = date.getHours();
  if (h < 12) return 'greeting.morning';
  if (h < 17) return 'greeting.afternoon';
  return 'greeting.evening';
}

export function formatDate(iso, locale, opts = { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) {
  return new Date(iso).toLocaleDateString(locale, opts);
}

/** "15:00" → "3:00 PM" (en) or "15:00" (so). */
export function formatTime(hhmm, locale) {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(2026, 0, 1, h, m);
  return d.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
}

export function formatNumber(n, locale) {
  return n.toLocaleString(locale === 'so-SO' ? 'en-US' : locale);
}

export function formatClock(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
