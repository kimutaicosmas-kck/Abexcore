import clsx from 'clsx';
import { ASSIGNABLE_MODULES, MODULE_LABELS } from '../../utils/roleModules';

interface ModuleAccessPickerProps {
  value: string[];
  onChange: (modules: string[]) => void;
  disabled?: boolean;
  error?: string;
}

export function ModuleAccessPicker({ value, onChange, disabled, error }: ModuleAccessPickerProps) {
  const toggle = (module: string) => {
    if (disabled) return;
    if (module === 'dashboard') return;
    if (value.includes(module)) {
      onChange(value.filter((m) => m !== module));
    } else {
      onChange([...value, module]);
    }
  };

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-slate-700">Module access *</p>
      <p className="text-xs text-slate-500">
        {disabled
          ? 'Preview of modules included for the selected role. Change the role above to update access.'
          : 'Check the modules this user can access. Dashboard is always included.'}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 rounded-xl border border-slate-200 p-3 bg-slate-50/50">
        {ASSIGNABLE_MODULES.map((module) => {
          const checked = module === 'dashboard' || value.includes(module);
          const isLocked = module === 'dashboard';
          return (
            <label
              key={module}
              className={clsx(
                'flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm cursor-pointer',
                disabled && 'opacity-60 cursor-not-allowed',
                checked && 'bg-white border border-primary-100'
              )}
            >
              <input
                type="checkbox"
                className="rounded border-border"
                checked={checked}
                disabled={disabled || isLocked}
                onChange={() => toggle(module)}
              />
              <span className="text-slate-800">{MODULE_LABELS[module] || module}</span>
            </label>
          );
        })}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
