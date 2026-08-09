import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { LOGIN_WELCOME_FLAG } from '../../config/session';
import { resolveWelcomeMessage } from '../../utils/welcomeMessage';
import { playWelcomeChime } from '../../utils/welcomeSound';

const COLORS = ['#38bdf8', '#0ea5e9', '#2563eb', '#fbbf24', '#f59e0b', '#e0f2fe', '#7dd3fc', '#ffffff'];
const HOLD_MS = 3000;

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  color: string;
  rotation: number;
  spin: number;
  life: number;
  decay: number;
  gravity: number;
  shape: 'ribbon' | 'dot' | 'diamond';
};

function greetingForHour(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function burstParticles(width: number, height: number, count: number): Particle[] {
  const cx = width / 2;
  const cy = height * 0.36;
  const out: Particle[] = [];
  const shapes: Particle['shape'][] = ['ribbon', 'dot', 'diamond'];
  for (let i = 0; i < count; i++) {
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.65;
    const speed = 11 + Math.random() * 22;
    out.push({
      x: cx + (Math.random() - 0.5) * 90,
      y: cy + (Math.random() - 0.5) * 40,
      vx: Math.cos(angle) * speed * (0.65 + Math.random()),
      vy: Math.sin(angle) * speed - 5,
      w: 5 + Math.random() * 10,
      h: 8 + Math.random() * 16,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      rotation: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 0.55,
      life: 1,
      decay: 0.008 + Math.random() * 0.014,
      gravity: 0.16 + Math.random() * 0.12,
      shape: shapes[Math.floor(Math.random() * shapes.length)],
    });
  }
  return out;
}

function drawParticle(ctx: CanvasRenderingContext2D, p: Particle) {
  ctx.fillStyle = p.color;
  if (p.shape === 'dot') {
    ctx.beginPath();
    ctx.arc(0, 0, p.w * 0.45, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  if (p.shape === 'diamond') {
    ctx.beginPath();
    ctx.moveTo(0, -p.h / 2);
    ctx.lineTo(p.w / 2, 0);
    ctx.lineTo(0, p.h / 2);
    ctx.lineTo(-p.w / 2, 0);
    ctx.closePath();
    ctx.fill();
    return;
  }
  ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
}

export function LoginWelcomeToast() {
  const { user, company, isAuthenticated } = useAuth();
  const [visible, setVisible] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [settled, setSettled] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number>(0);
  const leavingRef = useRef(false);

  useEffect(() => {
    if (!isAuthenticated || !user) return;
    try {
      if (sessionStorage.getItem(LOGIN_WELCOME_FLAG) !== '1') return;
    } catch {
      return;
    }
    leavingRef.current = false;
    setSettled(false);
    setVisible(true);
    setLeaving(false);
    void playWelcomeChime();
  }, [isAuthenticated, user?.id]);

  useEffect(() => {
    if (!visible || leaving) return;
    const t = window.setTimeout(() => setSettled(true), 700);
    return () => window.clearTimeout(t);
  }, [visible, leaving]);

  useEffect(() => {
    if (!visible || leaving || prefersReducedMotion()) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    let particles = burstParticles(window.innerWidth, window.innerHeight, 260);
    let frame = 0;

    const tick = () => {
      frame += 1;
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      if (frame === 6 || frame === 14 || frame === 22 || frame === 32 || frame === 42) {
        particles = particles.concat(burstParticles(window.innerWidth, window.innerHeight, 110));
      }
      particles = particles.filter((p) => p.life > 0.02);
      for (const p of particles) {
        p.vy += p.gravity;
        p.vx *= 0.99;
        p.x += p.vx;
        p.y += p.vy;
        p.rotation += p.spin;
        p.life -= p.decay;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.globalAlpha = Math.max(0, p.life);
        drawParticle(ctx, p);
        ctx.restore();
      }
      rafRef.current = window.requestAnimationFrame(tick);
    };
    rafRef.current = window.requestAnimationFrame(tick);

    return () => {
      window.removeEventListener('resize', resize);
      window.cancelAnimationFrame(rafRef.current);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    };
  }, [visible, leaving]);

  const dismiss = () => {
    if (leavingRef.current) return;
    leavingRef.current = true;
    setLeaving(true);
    try {
      sessionStorage.removeItem(LOGIN_WELCOME_FLAG);
    } catch {
      // ignore
    }
    window.setTimeout(() => {
      setVisible(false);
      setLeaving(false);
      leavingRef.current = false;
    }, 380);
  };

  useEffect(() => {
    if (!visible || leaving) return;
    const t = window.setTimeout(dismiss, HOLD_MS);
    return () => window.clearTimeout(t);
  }, [visible, leaving]);

  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible]);

  const name = user?.firstName?.trim() || user?.email?.split('@')[0] || 'there';
  const greeting = greetingForHour(new Date().getHours());
  const headline = `Welcome back, ${name}`;
  const words = useMemo(() => headline.split(' '), [headline]);
  const message = resolveWelcomeMessage(company?.name, company?.welcomeMessage);

  if (!visible || !user) return null;

  return (
    <div
      className={`fixed inset-0 z-[70] flex items-center justify-center px-5 ${
        leaving ? 'animate-welcome-stage-out' : 'animate-welcome-stage-in'
      }`}
      role="dialog"
      aria-modal="true"
      aria-label={headline}
      onClick={dismiss}
    >
      <div className="absolute inset-0 z-0 bg-[#020617]/50" aria-hidden />
      <div className="ceremony-burst pointer-events-none absolute inset-0 z-0" aria-hidden />
      <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 z-[1]" aria-hidden />

      <div
        className={`relative z-20 w-full max-w-2xl text-center ${settled ? 'welcome-settled' : ''} ${
          leaving ? 'animate-welcome-copy-out' : 'animate-welcome-copy-in'
        }`}
      >
        <div className="welcome-panel rounded-3xl border border-white/20 bg-[#071525]/92 px-6 py-8 shadow-[0_24px_80px_rgba(2,6,23,0.55)] backdrop-blur-md sm:px-10 sm:py-10">
          <p className="welcome-line-1 mb-4 text-sm font-semibold uppercase tracking-[0.28em] sm:text-base">
            {greeting}
          </p>

          <h2 className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl">
            {words.map((word, i) => (
              <span
                key={`${word}-${i}`}
                className="welcome-word inline-block"
                style={{ animationDelay: `${40 + i * 50}ms` }}
              >
                {word}
              </span>
            ))}
          </h2>

          <p className="welcome-line-2 mx-auto mt-6 max-w-xl text-base font-medium leading-relaxed sm:text-lg">
            {message}
          </p>

          <div className="welcome-line-3 mx-auto mt-8 h-0.5 w-24 rounded-full bg-gradient-to-r from-transparent via-amber-300 to-transparent" />
        </div>
      </div>
    </div>
  );
}
