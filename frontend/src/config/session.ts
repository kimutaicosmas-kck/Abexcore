/** Minutes of inactivity before the user is signed out. Override at build time. */
export const INACTIVITY_TIMEOUT_MINUTES = Number(
  import.meta.env.VITE_INACTIVITY_TIMEOUT_MINUTES ?? 30
);

/** Show a warning this many minutes before logout. */
export const INACTIVITY_WARNING_MINUTES = Number(
  import.meta.env.VITE_INACTIVITY_WARNING_MINUTES ?? 2
);

export const LAST_ACTIVITY_KEY = 'apex_last_activity_at';

export const INACTIVITY_TIMEOUT_MS = INACTIVITY_TIMEOUT_MINUTES * 60 * 1000;
export const INACTIVITY_WARNING_MS = INACTIVITY_WARNING_MINUTES * 60 * 1000;

export function markUserActivity() {
  // localStorage so activity survives full page refresh (sessionStorage was wiping UX on F5).
  localStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now()));
}

export function clearUserActivity() {
  localStorage.removeItem(LAST_ACTIVITY_KEY);
  sessionStorage.removeItem(LAST_ACTIVITY_KEY);
}

export function getLastActivityAt(): number | null {
  const raw = localStorage.getItem(LAST_ACTIVITY_KEY) ?? sessionStorage.getItem(LAST_ACTIVITY_KEY);
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export function isInactivityExpired(now = Date.now()): boolean {
  const last = getLastActivityAt();
  if (last == null) return false;
  return now - last >= INACTIVITY_TIMEOUT_MS;
}

export function msUntilInactivityExpiry(now = Date.now()): number {
  const last = getLastActivityAt();
  if (last == null) return INACTIVITY_TIMEOUT_MS;
  return Math.max(0, INACTIVITY_TIMEOUT_MS - (now - last));
}
