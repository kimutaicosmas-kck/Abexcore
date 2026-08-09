/** Soft ceremonial chime for post-login welcome. No audio files required. */

let sharedCtx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  if (!sharedCtx || sharedCtx.state === 'closed') {
    sharedCtx = new Ctx();
  }
  return sharedCtx;
}

/** Call during login click so the browser unlocks audio before navigation. */
export async function unlockWelcomeAudio(): Promise<void> {
  try {
    const ctx = getCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') await ctx.resume();
  } catch {
    // ignore autoplay / unsupported
  }
}

function tone(
  ctx: AudioContext,
  frequency: number,
  start: number,
  duration: number,
  gainPeak: number
) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const filter = ctx.createBiquadFilter();

  osc.type = 'sine';
  osc.frequency.setValueAtTime(frequency, start);

  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(2400, start);

  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(gainPeak, start + 0.03);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);

  osc.start(start);
  osc.stop(start + duration + 0.02);
}

/** Ascending three-note welcome chime (C5 → E5 → G5). */
export async function playWelcomeChime(): Promise<void> {
  try {
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }
    const muted = localStorage.getItem('abexcore:welcomeSoundMuted');
    if (muted === '1') return;

    const ctx = getCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') await ctx.resume();

    const t0 = ctx.currentTime + 0.04;
    tone(ctx, 523.25, t0, 0.28, 0.09);
    tone(ctx, 659.25, t0 + 0.14, 0.3, 0.1);
    tone(ctx, 783.99, t0 + 0.3, 0.55, 0.12);
  } catch {
    // ignore
  }
}
