import clsx from 'clsx';
import { ASSIGNABLE_MODULES, MODULE_LABELS } from '../../utils/roleModules';

interface ModuleAccessPickerProps {
  value: string[];
  onChange: (modules: string[]) => void;
  /** Modules that come with the selected role — always on and locked. */
  roleBaseline?: string[];
  /** When set, only these modules are listed (company package limit). */
  availableModules?: string[];
  disabled?: boolean;
  error?: string;
  label?: string;
}

export function ModuleAccessPicker({
  value,
  onChange,
  roleBaseline = ['dashboard'],
  availableModules,
  disabled,
  error,
  label = 'Module access *',
}: ModuleAccessPickerProps) {
  const catalog = availableModules?.length
    ? ASSIGNABLE_MODULES.filter((m) => availableModules.includes(m))
    : [...ASSIGNABLE_MODULES];

  const baseline = new Set(
    (roleBaseline.includes('dashboard') ? roleBaseline : ['dashboard', ...roleBaseline]).filter((m) =>
      catalog.includes(m as (typeof ASSIGNABLE_MODULES)[number])
    )
  );

  const toggle = (module: string) => {
    if (disabled) return;
    if (baseline.has(module)) return;
    if (value.includes(module)) {
      onChange(value.filter((m) => m !== module));
    } else {
      onChange([...new Set([...roleBaseline, ...value, module].filter((m) => catalog.includes(m as (typeof ASSIGNABLE_MODULES)[number]) || baseline.has(m)))]);
    }
  };

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-slate-700">{label}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 rounded-2xl border border-slate-200 p-3 bg-slate-50/70">
        {catalog.map((module) => {
          const isRoleDefault = baseline.has(module);
          const checked = isRoleDefault || value.includes(module);
          return (
            <label
              key={module}
              className={clsx(
                'flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm border transition-colors',
                disabled && 'opacity-60 cursor-not-allowed',
                !disabled && !isRoleDefault && 'cursor-pointer hover:bg-white',
                checked ? 'bg-white border-primary-100 shadow-sm' : 'border-transparent',
                isRoleDefault && 'bg-primary-50/70 border-primary-100'
              )}
            >
              <input
                type="checkbox"
                className="rounded border-slate-300 text-primary-600 focus:ring-primary-500"
                checked={checked}
                disabled={disabled || isRoleDefault}
                onChange={() => toggle(module)}
              />
              <span className="min-w-0">
                <span className="block text-slate-800 font-medium leading-tight">
                  {MODULE_LABELS[module] || module}
                </span>
                {isRoleDefault && (
                  <span className="block text-[10px] font-semibold uppercase tracking-wide text-primary-600/80 mt-0.5">
                    Role default
                  </span>
                )}
              </span>
            </label>
          );
        })}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
