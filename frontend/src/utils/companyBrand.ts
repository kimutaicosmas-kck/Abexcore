/** Per-tenant theme only. Platform owner (AbexCore) always keeps the fixed product design. */

import type { CSSProperties } from 'react';
import { PLATFORM_COMPANY_SLUG } from '../constants/platform';

const DEFAULT_PRIMARY = '#2563eb';
const DEFAULT_ACCENT = '#0284c7';

/** Fixed AbexCore platform owner look — never randomized. */
export const ABEXCORE_PLATFORM_BRAND = {
  brandPrimary: '#2563eb',
  brandAccent: '#0284c7',
  docPrimaryColor: '#1e6bb8',
} as const;

export function isPlatformBrandSlug(slug?: string | null): boolean {
  if (!slug) return false;
  return slug.trim().toLowerCase() === PLATFORM_COMPANY_SLUG.toLowerCase();
}

function clamp(n: number, min = 0, max = 255) {
  return Math.min(max, Math.max(min, Math.round(n)));
}

function parseHex(hex: string | null | undefined): [number, number, number] | null {
  if (!hex || !/^#[0-9A-Fa-f]{6}$/.test(hex)) return null;
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

function toHex(r: number, g: number, b: number) {
  return `#${[r, g, b].map((c) => clamp(c).toString(16).padStart(2, '0')).join('')}`;
}

function mix(hex: string, toward: 'white' | 'black', amount: number) {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  const [r, g, b] = rgb;
  const t = toward === 'white' ? 255 : 0;
  return toHex(r + (t - r) * amount, g + (t - g) * amount, b + (t - b) * amount);
}

export function normalizeBrandHex(hex: string | null | undefined, fallback: string) {
  const rgb = parseHex(hex);
  return rgb ? toHex(...rgb) : fallback;
}

export function sidebarShellFromPrimary(primary: string) {
  const p = normalizeBrandHex(primary, DEFAULT_PRIMARY);
  return {
    bg: mix(p, 'black', 0.58),
    bgDeep: mix(p, 'black', 0.72),
    surface: mix(p, 'black', 0.48),
    border: `${mix(p, 'white', 0.35)}40`,
    active: `${p}40`,
    activeAccent: mix(p, 'white', 0.28),
    activeText: '#ffffff',
    glow: `${p}55`,
    rail: p,
  };
}

export type CompanyBrandInput = {
  slug?: string | null;
  brandPrimary?: string | null;
  brandAccent?: string | null;
  docPrimaryColor?: string | null;
} | null;

function clearInlineBrandVars(root: HTMLElement) {
  const keys = [
    '--color-primary-50',
    '--color-primary-100',
    '--color-primary-200',
    '--color-primary-300',
    '--color-primary-400',
    '--color-primary-500',
    '--color-primary-600',
    '--color-primary-700',
    '--color-primary-800',
    '--color-primary-900',
    '--color-accent-500',
    '--color-accent-600',
    '--color-accent-700',
    '--color-sidebar-bg',
    '--color-sidebar-surface',
    '--color-sidebar-border',
    '--color-sidebar',
    '--color-sidebar-active',
    '--color-sidebar-active-accent',
    '--color-sidebar-active-text',
    '--sidebar-glow',
    '--sidebar-rail',
    '--color-surface-muted',
    '--color-surface-subtle',
    '--color-border',
    '--color-border-strong',
  ];
  keys.forEach((k) => root.style.removeProperty(k));
}

/** Platform owner: restore default AbexCore CSS tokens (no tenant tint). */
export function applyPlatformOwnerBrand() {
  clearInlineBrandVars(document.documentElement);
}

/** Fixed dark AbexCore shell for the platform owner workspace. */
export function platformSidebarStyle(): CSSProperties {
  return {
    background: 'linear-gradient(180deg, #0c0d16 0%, #0a0b14 45%, #070810 100%)',
    boxShadow: '4px 0 40px rgba(0, 0, 0, 0.45), 1px 0 0 rgba(255, 255, 255, 0.04)',
    borderRightColor: 'rgba(255, 255, 255, 0.07)',
  };
}

/** Inline styles for tenant sidebars only. Platform owner uses platformSidebarStyle(). */
export function sidebarBrandStyle(brand: CompanyBrandInput): CSSProperties {
  if (isPlatformBrandSlug(brand?.slug)) {
    return platformSidebarStyle();
  }

  const primary = normalizeBrandHex(brand?.brandPrimary, DEFAULT_PRIMARY);
  const shell = sidebarShellFromPrimary(primary);
  return {
    ['--color-sidebar-bg' as string]: shell.bg,
    ['--color-sidebar-surface' as string]: shell.surface,
    ['--color-sidebar-border' as string]: shell.border,
    ['--color-sidebar' as string]: primary,
    ['--color-sidebar-active' as string]: shell.active,
    ['--color-sidebar-active-accent' as string]: shell.activeAccent,
    ['--color-sidebar-active-text' as string]: shell.activeText,
    ['--sidebar-glow' as string]: shell.glow,
    ['--sidebar-rail' as string]: shell.rail,
    background: `linear-gradient(165deg, ${shell.surface} 0%, ${shell.bg} 42%, ${shell.bgDeep} 100%)`,
    borderRightColor: shell.border,
    boxShadow: `4px 0 40px ${shell.glow}, inset 3px 0 0 ${shell.rail}`,
  };
}

/**
 * Apply theme for the *logged-in* company only.
 * Platform owner always gets the fixed AbexCore design.
 */
export function applyCompanyBrandToDocument(brand: CompanyBrandInput) {
  if (isPlatformBrandSlug(brand?.slug)) {
    applyPlatformOwnerBrand();
    return;
  }

  const root = document.documentElement;
  const primary = normalizeBrandHex(brand?.brandPrimary, DEFAULT_PRIMARY);
  const accent = normalizeBrandHex(brand?.brandAccent, DEFAULT_ACCENT);

  const primaryScale: Record<string, string> = {
    '50': mix(primary, 'white', 0.92),
    '100': mix(primary, 'white', 0.84),
    '200': mix(primary, 'white', 0.7),
    '300': mix(primary, 'white', 0.5),
    '400': mix(primary, 'white', 0.28),
    '500': mix(primary, 'white', 0.08),
    '600': primary,
    '700': mix(primary, 'black', 0.18),
    '800': mix(primary, 'black', 0.32),
    '900': mix(primary, 'black', 0.48),
  };

  Object.entries(primaryScale).forEach(([step, value]) => {
    root.style.setProperty(`--color-primary-${step}`, value);
  });

  root.style.setProperty('--color-accent-500', accent);
  root.style.setProperty('--color-accent-600', mix(accent, 'black', 0.12));
  root.style.setProperty('--color-accent-700', mix(accent, 'black', 0.28));

  const shell = sidebarShellFromPrimary(primary);
  root.style.setProperty('--color-sidebar-bg', shell.bg);
  root.style.setProperty('--color-sidebar-surface', shell.surface);
  root.style.setProperty('--color-sidebar-border', shell.border);
  root.style.setProperty('--color-sidebar', primary);
  root.style.setProperty('--color-sidebar-active', shell.active);
  root.style.setProperty('--color-sidebar-active-accent', shell.activeAccent);
  root.style.setProperty('--color-sidebar-active-text', shell.activeText);
  root.style.setProperty('--sidebar-glow', shell.glow);
  root.style.setProperty('--sidebar-rail', shell.rail);
  root.style.setProperty('--color-surface-muted', primaryScale['50']);
  root.style.setProperty('--color-surface-subtle', primaryScale['100']);
  root.style.setProperty('--color-border', primaryScale['200']);
  root.style.setProperty('--color-border-strong', primaryScale['300']);
}
