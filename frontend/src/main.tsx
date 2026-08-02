import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import './index.css';

const PORTRAIT_CLASS = 'force-mobile-portrait';

function isPhoneLikeDevice() {
  const shortest = Math.min(window.screen.width, window.screen.height);
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const noHover = window.matchMedia('(hover: none)').matches;
  return shortest <= 926 || (coarse && noHover && shortest <= 1180);
}

/** Lock API when allowed (installed PWA / Android Chrome). */
function lockPortraitOrientation() {
  const orientation = screen.orientation as ScreenOrientation & {
    lock?: (orientation: OrientationLockType) => Promise<void>;
  };
  if (typeof orientation?.lock !== 'function') return;
  orientation.lock('portrait').catch(() => undefined);
}

/** Keep phone UI upright even if the browser still flips to landscape. */
function syncForcedPortraitClass() {
  if (!isPhoneLikeDevice()) {
    document.documentElement.classList.remove(PORTRAIT_CLASS);
    return;
  }
  document.documentElement.classList.add(PORTRAIT_CLASS);
  lockPortraitOrientation();
}

syncForcedPortraitClass();
lockPortraitOrientation();

window.addEventListener('orientationchange', () => {
  syncForcedPortraitClass();
  lockPortraitOrientation();
});
window.addEventListener('resize', syncForcedPortraitClass);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    syncForcedPortraitClass();
    lockPortraitOrientation();
  }
});

// Many browsers only honor orientation.lock after a user gesture.
['pointerdown', 'touchstart', 'click'].forEach((eventName) => {
  document.addEventListener(
    eventName,
    () => {
      lockPortraitOrientation();
    },
    { passive: true, capture: true }
  );
});

registerSW({
  immediate: true,
  onNeedRefresh() {
    window.dispatchEvent(new Event('pwa-update-ready'));
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
