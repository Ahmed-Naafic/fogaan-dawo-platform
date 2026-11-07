/** Role → home route and label key. Roles use the API's names (PATIENT / DOCTOR / ADMIN). */
export const ROLE_HOME = Object.freeze({ PATIENT: '/patient', DOCTOR: '/doctor', ADMIN: '/admin' });

export const roleLabelKey = (role) => `roles.${String(role).toLowerCase()}`;

/** Which roles may open a given app path (mirrors the route guards in app/router.jsx). */
export function rolesForPath(pathname) {
  if (pathname === '/patient' || pathname.startsWith('/patient/')) return ['PATIENT'];
  if (pathname === '/doctor' || pathname.startsWith('/doctor/')) return ['DOCTOR'];
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return ['ADMIN'];
  if (pathname.startsWith('/consultation/')) return ['PATIENT', 'DOCTOR'];
  if (pathname === '/account' || pathname.startsWith('/account/')) return ['PATIENT', 'DOCTOR', 'ADMIN'];
  return null;
}

/**
 * Post-login destination. `next` comes from the URL, so it is only honoured when it is an internal
 * path of this app that the user's roles can open — never an arbitrary or external URL.
 */
export function safeNext(next, { activeRole, roles }) {
  const home = ROLE_HOME[activeRole] ?? '/';
  if (typeof next !== 'string' || next.length > 300) return home;
  if (!/^\/(patient|doctor|admin|consultation|account)(\/[A-Za-z0-9\-_/]*)?(\?[A-Za-z0-9\-_=&%.]*)?$/.test(next) || next.includes('//')) return home;
  const allowed = rolesForPath(next.split('?')[0]);
  return allowed && allowed.some((r) => roles.includes(r)) ? next : home;
}
