/** Company package modules — mirrors backend/src/config/companyModules.ts */

import { ASSIGNABLE_MODULES } from './roleModules';

export type CompanyModulePreset = 'manufacturing' | 'trading' | 'custom';

export const CORE_COMPANY_MODULES = ['dashboard', 'users', 'settings'] as const;

/** Finished-goods / trading package (no factory modules). */
export const TRADING_COMPANY_MODULES = [
  ...CORE_COMPANY_MODULES,
  'customers',
  'products',
  'inventory',
  'sales',
  'delivery',
  'finance',
  'hr',
  'reports',
] as const;

export const MANUFACTURING_COMPANY_MODULES = [...ASSIGNABLE_MODULES] as const;

export const PACKAGE_PRESET_OPTIONS: {
  value: CompanyModulePreset;
  label: string;
  description: string;
}[] = [
  {
    value: 'manufacturing',
    label: 'Manufacturing (full)',
    description: 'Production, procurement, quality, maintenance, and sales.',
  },
  {
    value: 'trading',
    label: 'Trading / finished goods',
    description: 'Sell stock without running production — lower package price.',
  },
  {
    value: 'custom',
    label: 'Custom modules',
    description: 'Pick exactly which modules this company can use.',
  },
];

export function resolveCompanyModules(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return [...MANUFACTURING_COMPANY_MODULES];
  }
  const valid = new Set<string>(ASSIGNABLE_MODULES);
  const modules = [
    ...new Set(
      raw
        .map((m) => String(m).trim().toLowerCase())
        .filter((m) => valid.has(m))
    ),
  ];
  for (const core of CORE_COMPANY_MODULES) {
    if (!modules.includes(core)) modules.unshift(core);
  }
  return modules.length ? modules : [...MANUFACTURING_COMPANY_MODULES];
}

export function modulesForPreset(preset: CompanyModulePreset, custom?: string[]): string[] {
  if (preset === 'trading') return [...TRADING_COMPANY_MODULES];
  if (preset === 'custom') return resolveCompanyModules(custom ?? TRADING_COMPANY_MODULES);
  return [...MANUFACTURING_COMPANY_MODULES];
}

export function detectModulePreset(raw: unknown): CompanyModulePreset {
  const resolved = resolveCompanyModules(raw);
  const sameSet = (a: readonly string[], b: string[]) =>
    a.length === b.length && a.every((m) => b.includes(m));
  if (sameSet(TRADING_COMPANY_MODULES, resolved)) return 'trading';
  if (sameSet(MANUFACTURING_COMPANY_MODULES, resolved)) return 'manufacturing';
  return 'custom';
}

export function packageLabel(raw: unknown): string {
  const preset = detectModulePreset(raw);
  if (preset === 'trading') return 'Trading';
  if (preset === 'manufacturing') return 'Manufacturing';
  return 'Custom';
}
