/** Deterministic modern brand palette from a company seed (slug or id). */

export type CompanyBrandPalette = {
  brandPrimary: string;
  brandAccent: string;
  docPrimaryColor: string;
};

/** Fixed AbexCore product look — used when a tenant chooses brandMode = abexcore. */
export const ABEXCORE_PLATFORM_PALETTE: CompanyBrandPalette = {
  brandPrimary: '#2563eb',
  brandAccent: '#0284c7',
  docPrimaryColor: '#1e6bb8',
};

export type CompanyBrandMode = 'abexcore' | 'unique';

export function normalizeBrandMode(value?: string | null): CompanyBrandMode {
  return value === 'abexcore' ? 'abexcore' : 'unique';
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(n)));
}

function hashSeed(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function hslToHex(h: number, s: number, l: number): string {
  const sat = s / 100;
  const light = l / 100;
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const hp = (h % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp >= 0 && hp < 1) {
    r = c;
    g = x;
  } else if (hp < 2) {
    r = x;
    g = c;
  } else if (hp < 3) {
    g = c;
    b = x;
  } else if (hp < 4) {
    g = x;
    b = c;
  } else if (hp < 5) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  const m = light - c / 2;
  return `#${[r, g, b]
    .map((v) => clamp((v + m) * 255, 0, 255).toString(16).padStart(2, '0'))
    .join('')}`;
}

/**
 * Pick a modern, readable palette unique to the company.
 * Avoids washed pastels; keeps contrast for sidebar + PDF stationery.
 */
export function generateCompanyBrandPalette(seed: string): CompanyBrandPalette {
  const h = hashSeed(seed.trim().toLowerCase() || 'company');
  // Spread hues; skip a narrow muddy yellow band by remapping.
  let hue = h % 360;
  if (hue >= 45 && hue <= 70) hue = (hue + 90) % 360;

  const sat = 52 + (h % 18); // 52–69
  const light = 34 + ((h >> 5) % 10); // 34–43
  const accentHue = (hue + 28 + ((h >> 9) % 24)) % 360;
  const docHue = (hue + 350 + ((h >> 13) % 20)) % 360;

  return {
    brandPrimary: hslToHex(hue, sat, light),
    brandAccent: hslToHex(accentHue, Math.min(70, sat + 4), Math.min(48, light + 6)),
    docPrimaryColor: hslToHex(docHue, sat - 2, Math.max(30, light - 2)),
  };
}
