import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import './index.css';

/** Prefer portrait on phones (installed PWA / supporting browsers). */
function lockPortraitOrientation() {
  const orientation = screen.orientation as ScreenOrientation & {
    lock?: (orientation: OrientationLockType) => Promise<void>;
  };
  if (typeof orientation?.lock !== 'function') return;
  orientation.lock('portrait').catch(() => {
    /* ignore — desktop / browser tab may disallow */
  });
}

lockPortraitOrientation();
window.addEventListener('orientationchange', lockPortraitOrientation);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) lockPortraitOrientation();
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
