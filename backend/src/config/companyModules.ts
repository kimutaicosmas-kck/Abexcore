import { PERMISSION_MODULES } from './rolePermissions';

export const COMPANY_MODULES = [...PERMISSION_MODULES] as const;
export type CompanyModule = (typeof COMPANY_MODULES)[number];

const VALID = new Set<string>(COMPANY_MODULES);

/** Always available so the tenant can sign in and administer itself. */
export const CORE_COMPANY_MODULES: readonly CompanyModule[] = [
  'dashboard',
  'users',
  'settings',
];

/**
 * Trading / finished-goods sellers — sell stock without running a factory.
 * Cheaper package: no production, quality, maintenance, or procurement plant workflows.
 */
export const TRADING_COMPANY_MODULES: readonly CompanyModule[] = [
  ...CORE_COMPANY_MODULES,
  'customers',
  'products',
  'inventory',
  'sales',
  'pos',
  'delivery',
  'finance',
  'hr',
  'reports',
];

export const MANUFACTURING_COMPANY_MODULES: readonly CompanyModule[] = [...COMPANY_MODULES];

export type CompanyModulePreset = 'manufacturing' | 'trading' | 'custom';

/** POS checkout creates sales orders — keep sales when POS is selected.
 * Do not auto-add POS back when a company intentionally disables it.
 */
function withModuleDependencies(modules: string[]): string[] {
  const next = [...modules];
  if (next.includes('pos') && !next.includes('sales')) next.push('sales');
  return next;
}

export function normalizeCompanyModules(raw: unknown): string[] | null {
  if (raw == null) return null;
  if (!Array.isArray(raw)) return null;
  const modules = withModuleDependencies([
    ...new Set(
      raw
        .map((m) => String(m).trim().toLowerCase())
        .filter((m) => VALID.has(m))
    ),
  ]);
  for (const core of CORE_COMPANY_MODULES) {
    if (!modules.includes(core)) modules.unshift(core);
  }
  return modules.length ? modules : [...MANUFACTURING_COMPANY_MODULES];
}

/** null / empty stored value → full access (backward compatible). */
export function resolveCompanyModules(raw: unknown): string[] {
  const normalized = normalizeCompanyModules(raw);
  return normalized ?? [...MANUFACTURING_COMPANY_MODULES];
}

export function modulesForPreset(preset: CompanyModulePreset, custom?: unknown): string[] {
  if (preset === 'trading') return [...TRADING_COMPANY_MODULES];
  if (preset === 'custom') return normalizeCompanyModules(custom) ?? [...TRADING_COMPANY_MODULES];
  return [...MANUFACTURING_COMPANY_MODULES];
}

export function companyAllowsModule(enabledModules: unknown, module: string): boolean {
  return resolveCompanyModules(enabledModules).includes(module);
}

/** Keep only modules allowed by the company package. */
export function clampModulesToCompany(modules: string[] | null | undefined, enabledModules: unknown): string[] {
  const allowed = new Set(resolveCompanyModules(enabledModules));
  const next = (modules || []).filter((m) => allowed.has(m));
  for (const core of CORE_COMPANY_MODULES) {
    if (!next.includes(core)) next.unshift(core);
  }
  return next.length ? [...new Set(next)] : resolveCompanyModules(enabledModules);
}
