/** Module labels and role resolution for user access assignment. */

export const MODULE_LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  users: 'Users & admin',
  customers: 'Customers & CRM',
  products: 'Products (catalog)',
  inventory: 'Inventory & warehouse',
  procurement: 'Procurement',
  production: 'Production',
  sales: 'Sales',
  delivery: 'Delivery & logistics',
  finance: 'Finance & accounts',
  hr: 'Human resources',
  maintenance: 'Maintenance',
  quality: 'Quality control',
  reports: 'Reports',
  settings: 'Company settings',
};

export const ASSIGNABLE_MODULES = [
  'dashboard',
  'customers',
  'products',
  'inventory',
  'procurement',
  'production',
  'sales',
  'delivery',
  'finance',
  'hr',
  'maintenance',
  'quality',
  'reports',
  'settings',
  'users',
] as const;

/** Mirrors backend ROLE_MODULE_ACCESS (demo + production role names). */
const ROLE_MODULE_ACCESS: Record<string, readonly string[]> = {
  'Managing Director': ASSIGNABLE_MODULES,
  'General Manager': ASSIGNABLE_MODULES,
  'Operations Manager': ['dashboard', 'production', 'inventory', 'procurement', 'quality', 'delivery'],
  'Production Manager': ['dashboard', 'production', 'inventory', 'quality'],
  'Sales Manager': ['dashboard', 'customers', 'sales', 'delivery', 'reports'],
  'Procurement Manager': ['dashboard', 'procurement', 'inventory', 'reports'],
  'Warehouse Manager': ['dashboard', 'inventory', 'delivery'],
  'Quality Manager': ['dashboard', 'quality', 'production'],
  'Finance Manager': ['dashboard', 'finance', 'reports', 'sales'],
  'HR Manager': ['dashboard', 'hr'],
  'Procurement Officer': ['dashboard', 'procurement', 'inventory'],
  'Warehouse Officer': ['dashboard', 'inventory'],
  Storekeeper: ['dashboard', 'inventory'],
  'Sales Officer': ['dashboard', 'customers', 'sales'],
  'Sales Executive': ['dashboard', 'customers', 'sales'],
  'Sales Representative': ['dashboard', 'customers', 'sales'], // legacy
  'Machine Operator': ['dashboard', 'production'],
  'Finance Officer': ['dashboard', 'finance', 'reports'],
  Accountant: ['dashboard', 'finance', 'reports'],
  HR: ['dashboard', 'hr'],
  'Customer Service': ['dashboard', 'customers'],
  'Logistics & Delivery': ['dashboard', 'delivery'],
  Driver: ['dashboard', 'delivery'], // legacy
  Auditor: ['dashboard', 'reports', 'finance'],
};

const MODULE_DEPARTMENT: Record<string, string> = {
  finance: 'Finance',
  production: 'Production',
  procurement: 'Procurement',
  inventory: 'Warehouse',
  sales: 'Sales',
  hr: 'HR',
  quality: 'Quality Control',
  customers: 'Sales',
  delivery: 'Warehouse',
};

export function resolveRoleIdFromModules(
  modules: string[],
  roles: { id: string; name: string }[]
): string | undefined {
  if (!roles.length) return undefined;

  const selected = new Set(modules);
  if (selected.size === 0) {
    return (
      roles.find((r) => r.name === 'Sales Executive')?.id ||
      roles.find((r) => r.name === 'Sales Representative')?.id ||
      roles.find((r) => r.name === 'Sales Officer')?.id ||
      roles[0]?.id
    );
  }

  let bestRole =
    roles.find((r) => r.name === 'Sales Executive') ||
    roles.find((r) => r.name === 'Sales Representative') ||
    roles.find((r) => r.name === 'Sales Officer') ||
    roles[0];
  let bestScore = -1;

  for (const role of roles) {
    if (role.name === 'Super Admin' || role.name === 'Managing Director' || role.name === 'General Manager') {
      continue;
    }
    const roleModules = ROLE_MODULE_ACCESS[role.name] || ['dashboard'];
    const score = roleModules.filter((m) => selected.has(m)).length;
    if (score > bestScore) {
      bestScore = score;
      bestRole = role;
    }
  }

  if (selected.has('finance')) {
    const financeRole =
      roles.find((r) => r.name === 'Finance Manager') || roles.find((r) => r.name === 'Finance Officer');
    if (financeRole) return financeRole.id;
  }

  return bestRole.id;
}

export function resolveDepartmentIdFromModules(
  modules: string[],
  departments: { id: string; name: string }[]
): string | undefined {
  for (const mod of modules) {
    const deptName = MODULE_DEPARTMENT[mod];
    if (!deptName) continue;
    const dept = departments.find((d) => d.name === deptName);
    if (dept) return dept.id;
  }
  return departments.find((d) => d.name === 'Management' || d.name === 'Administration')?.id;
}

export function modulesForRoleName(roleName: string): string[] {
  if (roleName === 'Super Admin') return [...ASSIGNABLE_MODULES];
  return [...(ROLE_MODULE_ACCESS[roleName] || ['dashboard'])];
}

/** Merge role defaults with optional extra modules (role baseline always kept). */
export function mergeRoleAndExtraModules(roleName: string, selected: string[]): string[] {
  const baseline = modulesForRoleName(roleName);
  const extras = selected.filter((m) => !baseline.includes(m));
  const merged = [...new Set([...baseline, ...extras])];
  if (!merged.includes('dashboard')) merged.unshift('dashboard');
  return merged;
}
