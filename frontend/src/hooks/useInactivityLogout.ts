import { useCallback, useEffect, useRef, useState } from 'react';
import {
  INACTIVITY_WARNING_MS,
  getLastActivityAt,
  isInactivityExpired,
  markUserActivity,
  msUntilInactivityExpiry,
} from '../config/session';

const ACTIVITY_EVENTS: (keyof WindowEventMap)[] = [
  'mousedown',
  'keydown',
  'scroll',
  'touchstart',
  'click',
];

const ACTIVITY_THROTTLE_MS = 15_000;

interface UseInactivityLogoutOptions {
  enabled: boolean;
  onTimeout: () => void;
}

export function useInactivityLogout({ enabled, onTimeout }: UseInactivityLogoutOptions) {
  const [showWarning, setShowWarning] = useState(false);
  const logoutTimerRef = useRef<number | undefined>(undefined);
  const warningTimerRef = useRef<number | undefined>(undefined);
  const lastTouchRef = useRef(0);
  const onTimeoutRef = useRef(onTimeout);

  onTimeoutRef.current = onTimeout;

  const clearTimers = useCallback(() => {
    if (logoutTimerRef.current) window.clearTimeout(logoutTimerRef.current);
    if (warningTimerRef.current) window.clearTimeout(warningTimerRef.current);
    logoutTimerRef.current = undefined;
    warningTimerRef.current = undefined;
  }, []);

  const scheduleTimers = useCallback(() => {
    clearTimers();

    if (isInactivityExpired()) {
      onTimeoutRef.current();
      return;
    }

    const remaining = msUntilInactivityExpiry();
    const warningIn = Math.max(0, remaining - INACTIVITY_WARNING_MS);

    if (remaining <= INACTIVITY_WARNING_MS) {
      setShowWarning(true);
    } else {
      warningTimerRef.current = window.setTimeout(() => setShowWarning(true), warningIn);
    }

    logoutTimerRef.current = window.setTimeout(() => {
      onTimeoutRef.current();
    }, remaining);
  }, [clearTimers]);

  const touchActivity = useCallback(() => {
    const now = Date.now();
    if (now - lastTouchRef.current < ACTIVITY_THROTTLE_MS) {
      return;
    }
    lastTouchRef.current = now;
    markUserActivity();
    setShowWarning(false);
    scheduleTimers();
  }, [scheduleTimers]);

  const staySignedIn = useCallback(() => {
    markUserActivity();
    setShowWarning(false);
    scheduleTimers();
  }, [scheduleTimers]);

  useEffect(() => {
    if (!enabled) {
      clearTimers();
      setShowWarning(false);
      return;
    }

    if (getLastActivityAt() == null) {
      markUserActivity();
    } else if (isInactivityExpired()) {
      onTimeoutRef.current();
      return;
    }

    scheduleTimers();

    const onActivity = () => touchActivity();
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        if (isInactivityExpired()) {
          onTimeoutRef.current();
          return;
        }
        scheduleTimers();
      }
    };

    ACTIVITY_EVENTS.forEach((event) => window.addEventListener(event, onActivity, { passive: true }));
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      clearTimers();
      ACTIVITY_EVENTS.forEach((event) => window.removeEventListener(event, onActivity));
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [enabled, clearTimers, scheduleTimers, touchActivity]);

  return { showWarning, staySignedIn };
}
