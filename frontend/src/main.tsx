import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import './index.css';

/** Portrait lock only for installed PWA / standalone — never rotate desktop CSS. */
function lockPortraitOrientation() {
  const standalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (!standalone) return;

  const orientation = screen.orientation as ScreenOrientation & {
    lock?: (orientation: OrientationLockType) => Promise<void>;
  };
  if (typeof orientation?.lock !== 'function') return;
  orientation.lock('portrait').catch(() => undefined);
}

lockPortraitOrientation();
window.addEventListener('orientationchange', lockPortraitOrientation);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) lockPortraitOrientation();
});
document.addEventListener(
  'pointerdown',
  () => {
    lockPortraitOrientation();
  },
  { passive: true, capture: true }
);

// autoUpdate in vite.config — apply new SW quietly; reload only when the tab is hidden
// so users are never interrupted mid-work by an "Update now" prompt.
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    const applyQuietly = () => {
      void updateSW(true);
    };
    if (document.visibilityState === 'hidden') {
      applyQuietly();
      return;
    }
    const onHide = () => {
      if (document.visibilityState !== 'hidden') return;
      document.removeEventListener('visibilitychange', onHide);
      applyQuietly();
    };
    document.addEventListener('visibilitychange', onHide);
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
