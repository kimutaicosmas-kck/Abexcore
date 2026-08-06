/**
 * Distinct KPI card tones — each entry uses a different hue so cards
 * side-by-side never look like the same blue/green pair.
 */
export const STAT_TONES = {
  emerald: 'from-emerald-500 to-emerald-700',
  sky: 'from-sky-500 to-sky-700',
  violet: 'from-violet-500 to-violet-700',
  amber: 'from-amber-500 to-amber-700',
  rose: 'from-rose-500 to-rose-700',
  cyan: 'from-cyan-500 to-cyan-700',
  orange: 'from-orange-500 to-orange-700',
  indigo: 'from-indigo-500 to-indigo-700',
  teal: 'from-teal-500 to-teal-700',
  fuchsia: 'from-fuchsia-500 to-fuchsia-700',
  lime: 'from-lime-500 to-lime-700',
  blue: 'from-blue-500 to-blue-700',
  pink: 'from-pink-500 to-pink-700',
  slate: 'from-slate-500 to-slate-700',
  red: 'from-red-500 to-red-700',
} as const;

export type StatTone = keyof typeof STAT_TONES;

/** Default 5-card row: five clearly different hues. */
export const STAT_ROW_5 = [
  STAT_TONES.emerald,
  STAT_TONES.sky,
  STAT_TONES.violet,
  STAT_TONES.amber,
  STAT_TONES.rose,
] as const;

export const STAT_ROW_5_B = [
  STAT_TONES.teal,
  STAT_TONES.indigo,
  STAT_TONES.orange,
  STAT_TONES.fuchsia,
  STAT_TONES.cyan,
] as const;

export const STAT_ROW_5_C = [
  STAT_TONES.blue,
  STAT_TONES.lime,
  STAT_TONES.pink,
  STAT_TONES.amber,
  STAT_TONES.slate,
] as const;

export const STAT_ROW_4 = [
  STAT_TONES.emerald,
  STAT_TONES.sky,
  STAT_TONES.violet,
  STAT_TONES.amber,
] as const;

export const STAT_ROW_3 = [STAT_TONES.emerald, STAT_TONES.sky, STAT_TONES.violet] as const;
