import { useEffect, useState } from 'react';
import { Download, RefreshCw, Share, WifiOff, X } from 'lucide-react';
import { Button } from '../ui';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function isStandaloneMode() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** Phones only — never suggest install on laptop/desktop (or iPad). */
function isPhoneDevice(): boolean {
  const ua = navigator.userAgent || '';
  const mobileUa = /iPhone|iPod|Android.*Mobile|Windows Phone/i.test(ua);
  if (!mobileUa) return false;
  // Desktop Chrome DevTools mobile emulation can fire install prompts — skip on fine pointer + wide screens.
  if (window.matchMedia('(pointer: fine)').matches && window.innerWidth > 768) return false;
  return true;
}

const PWA_INSTALL_DISMISSED_KEY = 'abexcore-pwa-install-dismissed';

function detectPlatform(): 'ios' | 'android' | 'other' {
  const ua = navigator.userAgent;
  if (/iphone|ipod/i.test(ua)) return 'ios';
  if (/android/i.test(ua)) return 'android';
  return 'other';
}

export function PwaShell() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installDismissed, setInstallDismissed] = useState(false);
  const [offlineDismissed, setOfflineDismissed] = useState(false);
  const [isStandalone] = useState(isStandaloneMode);
  const [isPhone] = useState(isPhoneDevice);
  const [platform] = useState(detectPlatform);
  const isSecure = window.isSecureContext;

  const showManualInstall =
    isPhone &&
    !isStandalone &&
    !installDismissed &&
    !installPrompt &&
    (!isSecure || platform === 'ios');

  useEffect(() => {
    const onOnline = () => {
      setIsOnline(true);
      setOfflineDismissed(false);
    };
    const onOffline = () => setIsOnline(false);
    const onInstallPrompt = (event: Event) => {
      // Desktop Chrome also fires this — ignore unless on a phone.
      // Do not preventDefault if the user dismissed our banner this session (avoids Chrome console noise).
      if (!isPhoneDevice() || isStandaloneMode()) return;
      if (sessionStorage.getItem(PWA_INSTALL_DISMISSED_KEY) === '1') return;
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener('beforeinstallprompt', onInstallPrompt);

    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('beforeinstallprompt', onInstallPrompt);
    };
  }, []);

  const dismissInstall = () => {
    sessionStorage.setItem(PWA_INSTALL_DISMISSED_KEY, '1');
    setInstallDismissed(true);
    setInstallPrompt(null);
  };

  const handleInstall = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    setInstallPrompt(null);
    setInstallDismissed(true);
    if (choice.outcome === 'accepted') {
      sessionStorage.removeItem(PWA_INSTALL_DISMISSED_KEY);
    } else {
      sessionStorage.setItem(PWA_INSTALL_DISMISSED_KEY, '1');
    }
  };

  const manualInstallText =
    platform === 'ios'
      ? 'Tap Share, then “Add to Home Screen”.'
      : platform === 'android'
        ? isSecure
          ? 'Tap the menu (⋮), then “Install app” or “Add to Home screen”.'
          : 'Install needs HTTPS. Use the secure link your admin shared, or tap menu (⋮) → Add to Home screen for a shortcut only.'
        : 'Use your browser menu to add this page to your home screen.';

  const recheckConnection = () => {
    setIsOnline(navigator.onLine);
    if (navigator.onLine) setOfflineDismissed(true);
  };

  return (
    <>
      {!isOnline && !offlineDismissed && (
        <div className="fixed top-[calc(3.5rem+env(safe-area-inset-top))] inset-x-0 z-50 px-3 sm:px-4">
          <div className="mx-auto max-w-[1600px] rounded-xl ring-1 ring-amber-200 bg-amber-50 px-4 py-3 shadow-soft">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 shrink-0 rounded-lg bg-white/70 p-1.5 text-amber-700">
                <WifiOff className="h-4 w-4" aria-hidden />
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                <p className="text-sm font-semibold text-slate-900">No internet connection</p>
                <p className="text-sm text-slate-700">
                  Live data and sign-in need an active connection. Previously loaded screens may still appear.
                </p>
                <p className="text-xs text-slate-500">
                  Turn on Wi‑Fi or mobile data. We will reconnect automatically when you are back online.
                </p>
              </div>
              <div className="flex shrink-0 flex-col gap-1">
                <button
                  type="button"
                  onClick={recheckConnection}
                  className="inline-flex items-center gap-1 rounded-lg bg-white/80 px-2.5 py-1.5 text-xs font-semibold text-primary-700 ring-1 ring-primary-200 hover:bg-white"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Retry
                </button>
                <button
                  type="button"
                  aria-label="Dismiss offline notice"
                  onClick={() => setOfflineDismissed(true)}
                  className="rounded-lg p-1.5 text-amber-700 hover:bg-amber-100 self-end"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {isPhone && installPrompt && !installDismissed && (
        <div className="fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] lg:bottom-4 inset-x-0 z-50 px-4 pb-[max(0.5rem,env(safe-area-inset-bottom))] lg:pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="mx-auto max-w-lg flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-float">
            <div className="flex items-start gap-2 text-sm text-slate-700">
              <Download className="h-4 w-4 mt-0.5 text-primary-600 shrink-0" />
              <span>Install AbexCore ERP on this device for quick access from your home screen.</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button variant="secondary" size="sm" onClick={dismissInstall}>
                Not now
              </Button>
              <Button size="sm" onClick={handleInstall}>
                Install app
              </Button>
            </div>
          </div>
        </div>
      )}

      {showManualInstall && (
        <div className="fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] lg:bottom-4 inset-x-0 z-50 px-4 pb-[max(0.5rem,env(safe-area-inset-bottom))] lg:pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="mx-auto max-w-lg rounded-xl border border-primary-200 bg-white px-4 py-3 shadow-float">
            <div className="flex items-start gap-2 text-sm text-slate-700">
              {platform === 'ios' ? (
                <Share className="h-4 w-4 mt-0.5 text-primary-600 shrink-0" />
              ) : (
                <Download className="h-4 w-4 mt-0.5 text-primary-600 shrink-0" />
              )}
              <div>
                <p className="font-medium text-slate-900">Add AbexCore to your home screen</p>
                <p className="mt-1">{manualInstallText}</p>
                {!isSecure && platform === 'android' && (
                  <p className="mt-2 text-xs text-amber-700">
                    HTTP links cannot show the automatic install button. Ask for the HTTPS link for full PWA install.
                  </p>
                )}
              </div>
            </div>
            <div className="mt-3 flex justify-end">
              <Button variant="secondary" size="sm" onClick={dismissInstall}>
                Got it
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
