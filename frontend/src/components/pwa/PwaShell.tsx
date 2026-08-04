import { useEffect, useState } from 'react';
import { Download, Share, WifiOff, X } from 'lucide-react';
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
  if (/iPhone|iPod/i.test(ua)) return true;
  if (/Android/i.test(ua) && /Mobile/i.test(ua)) return true;
  if (/Windows Phone/i.test(ua)) return true;
  return false;
}

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
      // Only preventDefault when we will show our own Install button (avoids console noise).
      if (!isPhoneDevice() || isStandaloneMode()) return;
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

  const handleInstall = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === 'accepted') {
      setInstallPrompt(null);
    }
    setInstallDismissed(true);
  };

  const manualInstallText =
    platform === 'ios'
      ? 'Tap Share, then “Add to Home Screen”.'
      : platform === 'android'
        ? isSecure
          ? 'Tap the menu (⋮), then “Install app” or “Add to Home screen”.'
          : 'Install needs HTTPS. Use the secure link your admin shared, or tap menu (⋮) → Add to Home screen for a shortcut only.'
        : 'Use your browser menu to add this page to your home screen.';

  return (
    <>
      {!isOnline && !offlineDismissed && (
        <div className="fixed top-14 inset-x-0 z-50 px-4 pt-[env(safe-area-inset-top)]">
          <div className="mx-auto max-w-[1600px] flex items-start justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 shadow-soft">
            <div className="flex items-start gap-2 text-sm text-amber-900 min-w-0 flex-1">
              <WifiOff className="h-4 w-4 shrink-0 mt-0.5" />
              <span>You are offline. Cached pages work; live data refreshes when connection returns.</span>
            </div>
            <button
              type="button"
              aria-label="Dismiss offline notice"
              onClick={() => setOfflineDismissed(true)}
              className="rounded-lg p-1 text-amber-700 hover:bg-amber-100"
            >
              <X className="h-4 w-4" />
            </button>
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
              <Button variant="secondary" size="sm" onClick={() => setInstallDismissed(true)}>
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
              <Button variant="secondary" size="sm" onClick={() => setInstallDismissed(true)}>
                Got it
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
