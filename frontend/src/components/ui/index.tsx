import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { ChevronRight } from 'lucide-react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading,
  className,
  children,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={clsx(
        'inline-flex items-center justify-center font-medium rounded-xl transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]',
        {
          'bg-primary-600 text-white hover:bg-primary-700 shadow-sm shadow-primary-600/20 focus:ring-primary-500': variant === 'primary',
          'bg-white text-primary-800 border border-primary-200 hover:bg-primary-50 hover:border-primary-300 focus:ring-primary-500': variant === 'secondary',
          'bg-red-600 text-white hover:bg-red-700 shadow-sm shadow-red-600/20 focus:ring-red-500': variant === 'danger',
          'text-primary-700 hover:bg-primary-50 focus:ring-primary-400': variant === 'ghost',
          'px-3 py-1.5 text-xs': size === 'sm',
          'px-4 py-2 text-sm': size === 'md',
          'px-5 py-2.5 text-sm': size === 'lg',
        },
        className
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading && (
        <svg className="animate-spin -ml-1 mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      )}
      {children}
    </button>
  );
}

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export function Input({ label, error, className, id: idProp, ...props }: InputProps) {
  const autoId = useId();
  const id = idProp ?? autoId;

  return (
    <div className="space-y-1.5">
      {label && (
        <label htmlFor={id} className="block text-sm font-medium text-slate-700">
          {label}
        </label>
      )}
      <input
        id={id}
        className={clsx(
          'block w-full rounded-xl border border-primary-100 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 transition-all',
          error && 'border-red-400 focus:border-red-400 focus:ring-red-500/15',
          className
        )}
        {...props}
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}

interface NumberInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange' | 'value'> {
  label?: string;
  error?: string;
  value?: number | string;
  onChange?: (value: number) => void;
  step?: number;
  min?: number;
  max?: number;
}

export function NumberInput({
  label,
  error,
  className,
  id: idProp,
  value,
  onChange,
  step = 1,
  min,
  max,
  disabled,
  ...props
}: NumberInputProps) {
  const autoId = useId();
  const id = idProp ?? autoId;
  const numeric = Number(value ?? 0);

  const adjust = (delta: number) => {
    if (disabled) return;
    let next = numeric + delta;
    if (min != null) next = Math.max(min, next);
    if (max != null) next = Math.min(max, next);
    onChange?.(next);
  };

  return (
    <div className="space-y-1.5">
      {label && (
        <label htmlFor={id} className="block text-sm font-medium text-slate-700">
          {label}
        </label>
      )}
      <div className="flex items-stretch gap-1">
        <button
          type="button"
          disabled={disabled || (min != null && numeric <= min)}
          onClick={() => adjust(-step)}
          className="px-3 rounded-l-xl border border-primary-100 bg-primary-50 text-primary-800 hover:bg-primary-100 disabled:opacity-50"
          aria-label="Decrease"
        >
          −
        </button>
        <input
          id={id}
          type="number"
          step={step}
          min={min}
          max={max}
          disabled={disabled}
          value={value ?? ''}
          onChange={(e) => onChange?.(Number(e.target.value) || 0)}
          className={clsx(
            'block w-full border-y border-primary-100 bg-white px-3 py-2 text-sm text-slate-900 text-center focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20',
            error && 'border-red-400',
            className
          )}
          {...props}
        />
        <button
          type="button"
          disabled={disabled || (max != null && numeric >= max)}
          onClick={() => adjust(step)}
          className="px-3 rounded-r-xl border border-primary-100 bg-primary-50 text-primary-800 hover:bg-primary-100 disabled:opacity-50"
          aria-label="Increase"
        >
          +
        </button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  options: { value: string; label: string }[];
}

export function Select({ label, error, options, className, id: idProp, ...props }: SelectProps & { id?: string }) {
  const autoId = useId();
  const id = idProp ?? autoId;

  return (
    <div className="space-y-1.5">
      {label && (
        <label htmlFor={id} className="block text-sm font-medium text-slate-700">
          {label}
        </label>
      )}
      <select
        id={id}
        className={clsx(
          'block w-full rounded-xl border border-primary-100 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 transition-all',
          error && 'border-red-400 focus:border-red-400 focus:ring-red-500/15',
          className
        )}
        {...props}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}

interface CardProps {
  children: React.ReactNode;
  className?: string;
  title?: string;
  action?: React.ReactNode;
  padding?: boolean;
}

export function Card({ children, className, title, action, padding = true }: CardProps) {
  return (
    <div className={clsx('panel-surface min-w-0', className)}>
      {(title || action) && (
        <div className="panel-header flex items-center justify-between gap-2 px-3 py-2 sm:px-4 sm:py-3 min-w-0">
          {title && <h3 className="text-xs sm:text-sm font-semibold text-primary-900 min-w-0 flex-1 truncate">{title}</h3>}
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      <div className={padding ? 'p-3 sm:p-4 min-w-0' : undefined}>{children}</div>
    </div>
  );
}

interface BadgeProps {
  children: React.ReactNode;
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info';
}

export function Badge({ children, variant = 'default' }: BadgeProps) {
  return (
    <span
      className={clsx(
        'inline-flex items-center px-1.5 py-0.5 sm:px-2 rounded-md sm:rounded-full text-[10px] sm:text-xs font-semibold ring-1 ring-inset leading-tight',
        {
          'bg-primary-50 text-primary-800 ring-primary-200/80': variant === 'default',
          'bg-emerald-50 text-emerald-800 ring-emerald-200/80': variant === 'success',
          'bg-amber-50 text-amber-800 ring-amber-200/80': variant === 'warning',
          'bg-red-50 text-red-800 ring-red-200/80': variant === 'danger',
          'bg-primary-100 text-primary-800 ring-primary-200/80': variant === 'info',
        }
      )}
    >
      {children}
    </span>
  );
}

/** Resolve Tailwind color tokens used on stat cards to hex for the top accent bar. */
const STAT_ACCENT_HEX: Record<string, string> = {
  'primary-500': '#3b82f6',
  'primary-600': '#2563eb',
  'primary-700': '#1d4ed8',
  'primary-800': '#1e40af',
  'emerald-500': '#10b981',
  'emerald-700': '#047857',
  'teal-500': '#14b8a6',
  'teal-600': '#0d9488',
  'teal-700': '#0f766e',
  'orange-500': '#f97316',
  'orange-700': '#c2410c',
  'amber-500': '#f59e0b',
  'amber-600': '#d97706',
  'amber-700': '#b45309',
  'red-500': '#ef4444',
  'red-600': '#dc2626',
  'red-700': '#b91c1c',
  'rose-500': '#f43f5e',
  'rose-600': '#e11d48',
  'rose-700': '#be123c',
  'slate-500': '#64748b',
  'slate-600': '#475569',
  'slate-700': '#334155',
  'slate-800': '#1e293b',
  'sky-500': '#0ea5e9',
  'sky-700': '#0369a1',
  'cyan-500': '#06b6d4',
  'cyan-600': '#0891b2',
  'cyan-700': '#0e7490',
  'blue-500': '#3b82f6',
  'blue-600': '#2563eb',
  'blue-700': '#1d4ed8',
  'indigo-500': '#6366f1',
  'indigo-700': '#4338ca',
  'violet-500': '#8b5cf6',
  'violet-700': '#6d28d9',
  'fuchsia-500': '#d946ef',
  'fuchsia-700': '#a21caf',
  'pink-500': '#ec4899',
  'pink-700': '#be185d',
  'lime-500': '#84cc16',
  'lime-700': '#4d7c0f',
};

function resolveStatAccent(color: string): { from: string; to: string } {
  const fromMatch = color.match(/from-([a-z]+-\d+)/);
  const toMatch = color.match(/to-([a-z]+-\d+)/);
  const bgMatch = color.match(/bg-([a-z]+-\d+)/);
  const fromKey = fromMatch?.[1] || bgMatch?.[1] || 'primary-600';
  const toKey = toMatch?.[1] || fromKey;
  return {
    from: STAT_ACCENT_HEX[fromKey] || STAT_ACCENT_HEX['primary-600'],
    to: STAT_ACCENT_HEX[toKey] || STAT_ACCENT_HEX[fromKey] || STAT_ACCENT_HEX['primary-600'],
  };
}

interface StatCardProps {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  trend?: { value: number; label: string };
  color?: string;
  /** Navigate to a route when the card is clicked. */
  to?: string;
  /** Same-page action (e.g. switch tab / apply filter). Ignored when `to` is set. */
  onClick?: () => void;
}

export function StatCard({ title, value, icon, trend, color = 'bg-primary-600', to, onClick }: StatCardProps) {
  const interactive = Boolean(to || onClick);
  const accent = resolveStatAccent(color);
  const accentStyle = {
    ['--stat-accent-from' as string]: accent.from,
    ['--stat-accent-to' as string]: accent.to,
  } as React.CSSProperties;

  const content = (
    <>
      <div className="flex items-start justify-between gap-1.5 sm:gap-2">
        <p className="stat-card-title min-w-0 flex-1 text-[10px] sm:text-xs font-medium text-primary-700/70 uppercase tracking-wide leading-snug line-clamp-2">
          {title}
        </p>
        <div
          className={clsx(
            'stat-card-icon h-8 w-8 sm:h-10 sm:w-10 shrink-0 flex items-center justify-center rounded-xl sm:rounded-2xl text-white shadow-sm [&_svg]:h-3.5 [&_svg]:w-3.5 sm:[&_svg]:h-5 sm:[&_svg]:w-5',
            color.includes('from-') ? `bg-gradient-to-br ${color}` : color
          )}
        >
          {icon}
        </div>
      </div>
      <p className="stat-card-value text-base sm:text-xl font-bold tabular-nums text-primary-950 leading-none tracking-tight">
        {value}
      </p>
      {trend && (
        <p className={clsx('text-[10px] sm:text-xs font-medium whitespace-nowrap', trend.value >= 0 ? 'text-emerald-600' : 'text-red-600')}>
          {trend.value >= 0 ? '+' : ''}{trend.value}% {trend.label}
        </p>
      )}
    </>
  );

  const className = clsx(
    'stat-card flex flex-col gap-1.5 sm:gap-2.5 snap-start text-left w-full',
    interactive &&
      'stat-card-interactive cursor-pointer transition-all duration-150 hover:border-primary-300 hover:shadow-md hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2'
  );

  if (to) {
    return (
      <Link to={to} className={className} style={accentStyle} aria-label={`View ${title}`}>
        {content}
      </Link>
    );
  }

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={className} style={accentStyle} aria-label={`View ${title}`}>
        {content}
      </button>
    );
  }

  return (
    <div className={className} style={accentStyle}>
      {content}
    </div>
  );
}

type TableColumn = {
  key: string;
  label: string;
  render?: (value: unknown, row: Record<string, unknown>) => React.ReactNode;
};

interface TableProps {
  columns: TableColumn[];
  data: Record<string, unknown>[] | object[];
  loading?: boolean;
  onRowClick?: (row: Record<string, unknown>) => void;
  embedded?: boolean;
  /**
   * Stack rows as mobile cards (Customers/Users style) under `md`.
   * Default on so all list pages match that mobile layout.
   */
  responsive?: boolean;
  /** How many detail fields to show before “View details” (default 2). */
  mobileSummaryCount?: number;
}

const STATUS_KEYS = new Set(['status', 'isActive']);
const META_COLUMN_KEYS = new Set(['actions', 'select', 'checkbox']);

function renderCell(col: TableColumn, record: Record<string, unknown>) {
  return col.render ? col.render(record[col.key], record) : String(record[col.key] ?? '');
}

function MobileTableCard({
  record,
  columns,
  onRowClick,
  summaryCount,
}: {
  record: Record<string, unknown>;
  columns: TableColumn[];
  onRowClick?: (row: Record<string, unknown>) => void;
  summaryCount: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const actionCol = columns.find((col) => col.key === 'actions');
  const selectCol = columns.find((col) => col.key === 'select' || col.key === 'checkbox');
  const dataCols = columns.filter((col) => !META_COLUMN_KEYS.has(col.key));
  const primary = dataCols[0];
  const statusCol = dataCols.find((col) => STATUS_KEYS.has(col.key));
  const detailCols = dataCols
    .filter((col) => col.key !== primary?.key)
    .filter((col) => !STATUS_KEYS.has(col.key));
  const summaryCols = detailCols.slice(0, summaryCount);
  const hiddenCols = detailCols.slice(summaryCount);
  const showHidden = expanded && hiddenCols.length > 0;
  const visibleDetailCols = showHidden ? detailCols : summaryCols;

  return (
    <div className="mobile-list-row flex flex-col">
      {primary && (
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1 flex items-start gap-1.5">
            {selectCol?.render && (
              <div className="pt-0.5 shrink-0">{selectCol.render(record[selectCol.key], record)}</div>
            )}
            <div className="mobile-list-title min-w-0 flex-1 text-slate-900 [&_p]:leading-snug [&_p]:text-[inherit]">
              {renderCell(primary, record)}
            </div>
          </div>
          {statusCol && <div className="shrink-0 scale-95 origin-top-right">{renderCell(statusCol, record)}</div>}
        </div>
      )}

      {visibleDetailCols.length > 0 && (
        <div className="grid grid-cols-1 gap-0.5">
          {visibleDetailCols.map((col) => (
            <div key={col.key} className="mobile-list-detail flex items-center justify-between gap-2">
              <span className="mobile-list-label shrink-0">{col.label}</span>
              <div className="text-slate-800 text-right min-w-0 max-w-[68%] break-words">
                {renderCell(col, record)}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between gap-1.5">
        <div className="flex items-center gap-1 min-w-0">
          {onRowClick && (
            <Button
              size="sm"
              variant="secondary"
              className="!px-2 !py-1 !text-[10px] !rounded-lg"
              onClick={(e) => {
                e.stopPropagation();
                onRowClick(record);
              }}
            >
              Details
            </Button>
          )}
          {!onRowClick && hiddenCols.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              className="!px-2 !py-1 !text-[10px]"
              onClick={(e) => {
                e.stopPropagation();
                setExpanded((v) => !v);
              }}
            >
              {expanded ? 'Less' : `More (${hiddenCols.length})`}
            </Button>
          )}
        </div>
        {actionCol?.render && (
          <div className="flex items-center gap-0.5 shrink-0 scale-90 origin-right">
            {actionCol.render(record[actionCol.key], record)}
          </div>
        )}
      </div>
    </div>
  );
}

export function Table({
  columns,
  data,
  loading,
  onRowClick,
  embedded = false,
  responsive = true,
  mobileSummaryCount = 2,
}: TableProps) {
  const content = (() => {
    if (loading) {
      return (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-9 w-9 border-2 border-primary-200 border-t-primary-600" />
        </div>
      );
    }

    if (data.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="h-12 w-12 rounded-2xl bg-surface-subtle flex items-center justify-center mb-3">
            <span className="text-xl text-slate-400">—</span>
          </div>
          <p className="text-sm font-medium text-slate-600">No records found</p>
          <p className="text-xs text-slate-400 mt-1">Try adjusting filters or add a new entry</p>
        </div>
      );
    }

    return (
      <>
        {responsive && (
          <div className="md:hidden divide-y divide-border/70">
            {data.map((row, i) => (
              <MobileTableCard
                key={i}
                record={row as Record<string, unknown>}
                columns={columns}
                onRowClick={onRowClick}
                summaryCount={Math.max(0, mobileSummaryCount)}
              />
            ))}
          </div>
        )}

        <div className={clsx(responsive && 'hidden md:block', 'min-w-0')}>
          <div className={clsx('overflow-x-auto', embedded ? 'px-4 sm:px-0' : undefined)}>
            <table className="min-w-full">
              <thead>
                <tr className="border-b border-primary-100 bg-primary-50/80">
                  {columns.map((col) => (
                    <th
                      key={col.key}
                      className="px-3 sm:px-4 py-2.5 text-left text-[11px] font-semibold text-primary-800/70 uppercase tracking-wider whitespace-nowrap"
                    >
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/70">
                {data.map((row, i) => {
                  const record = row as Record<string, unknown>;
                  return (
                    <tr
                      key={i}
                      className={clsx(
                        'transition-colors',
                        onRowClick ? 'cursor-pointer hover:bg-primary-50/70' : 'hover:bg-primary-50/40'
                      )}
                      onClick={() => onRowClick?.(record)}
                    >
                      {columns.map((col) => (
                        <td
                          key={col.key}
                          className="px-3 sm:px-4 py-2.5 whitespace-nowrap text-sm text-slate-800 max-w-[12rem] truncate"
                        >
                          {col.render ? col.render(record[col.key], record) : String(record[col.key] ?? '')}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </>
    );
  })();

  if (embedded) return content;

  return (
    <div className="panel-surface ring-1 ring-primary-50">
      {content}
    </div>
  );
}

export function DataPanel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={clsx('panel-surface', className)}>
      {children}
    </div>
  );
}

interface TabGroupProps {
  tabs: string[];
  activeIndex: number;
  onChange: (index: number) => void;
  className?: string;
}

export function TabGroup({ tabs, activeIndex, onChange, className }: TabGroupProps) {
  return (
    <div className={clsx('page-tabs', className)}>
      {tabs.map((tab, i) => (
        <button
          key={tab}
          onClick={() => onChange(i)}
          className={clsx(
            'px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 whitespace-nowrap shrink-0',
            activeIndex === i
              ? 'bg-primary-600 text-white shadow-sm shadow-primary-600/25'
              : 'text-primary-700 hover:bg-white/80 hover:text-primary-800'
          )}
        >
          {tab}
        </button>
      ))}
    </div>
  );
}

/** Page-level actions only — title lives in TopNav. */
export function PageHeader({ subtitle, action }: { title?: string; subtitle?: string; action?: React.ReactNode }) {
  if (!subtitle && !action) return null;
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end mb-3">
      {subtitle && (
        <p className="text-xs text-primary-700/70 truncate sm:mr-auto">{subtitle}</p>
      )}
      {action && <div className="flex flex-wrap items-center gap-2 shrink-0">{action}</div>}
    </div>
  );
}

interface PageToolbarProps {
  tabs?: string[];
  activeTab?: number;
  onTabChange?: (index: number) => void;
  actions?: React.ReactNode;
  className?: string;
}

export function PageToolbar({ tabs, activeTab = 0, onTabChange, actions, className }: PageToolbarProps) {
  return (
    <div className={clsx('flex flex-col gap-2 md:flex-row md:items-center md:justify-between mb-3 min-w-0', className)}>
      {tabs && onTabChange && (
        <TabGroup tabs={tabs} activeIndex={activeTab} onChange={onTabChange} className="!mb-0 w-full md:w-auto" />
      )}
      {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
}

export function Textarea({ label, error, className, ...props }: TextareaProps) {
  return (
    <div className="space-y-1.5">
      {label && <label className="block text-sm font-medium text-slate-700">{label}</label>}
      <textarea
        className={clsx(
          'block w-full rounded-xl border border-primary-100 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 transition-all resize-y min-h-[72px]',
          error && 'border-red-400 focus:border-red-400 focus:ring-red-500/15',
          className
        )}
        {...props}
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}

interface AlertProps {
  children: React.ReactNode;
  variant?: 'success' | 'error' | 'info' | 'warning';
  className?: string;
}

export function Alert({ children, variant = 'info', className }: AlertProps) {
  return (
    <div
      className={clsx(
        'px-3 py-2 rounded-lg text-sm ring-1',
        {
          'bg-emerald-50 text-emerald-800 ring-emerald-200': variant === 'success',
          'bg-red-50 text-red-800 ring-red-200': variant === 'error',
          'bg-primary-50 text-primary-900 ring-primary-200': variant === 'info',
          'bg-amber-50 text-amber-900 ring-amber-200': variant === 'warning',
        },
        className
      )}
    >
      {children}
    </div>
  );
}

export function LoadingSpinner({ className, size = 'md' }: { className?: string; size?: 'sm' | 'md' | 'lg' }) {
  const sizeClass = { sm: 'h-6 w-6', md: 'h-9 w-9', lg: 'h-12 w-12' }[size];
  return (
    <div className={clsx('flex items-center justify-center', className)}>
      <div className={clsx('animate-spin rounded-full border-2 border-primary-200 border-t-primary-600', sizeClass)} />
    </div>
  );
}

interface EmptyStateProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-8 sm:py-14 px-3 sm:px-4 text-center rounded-xl border border-dashed border-primary-200 bg-primary-50/50">
      <div className="h-9 w-9 sm:h-12 sm:w-12 rounded-lg sm:rounded-xl bg-primary-100 flex items-center justify-center mb-2.5 sm:mb-4 text-primary-600 text-base sm:text-xl font-light">∅</div>
      <p className="text-xs sm:text-sm font-semibold text-primary-900">{title}</p>
      {description && <p className="text-[11px] sm:text-xs text-primary-700/70 mt-1 max-w-sm">{description}</p>}
      {action && <div className="mt-3 sm:mt-5">{action}</div>}
    </div>
  );
}

interface TablePaginationProps {
  pagination?: { page: number; totalPages: number; total?: number };
  page: number;
  onPageChange: (fn: (p: number) => number) => void;
  label?: string;
}

export function TablePagination({ pagination, page, onPageChange, label = 'records' }: TablePaginationProps) {
  if (!pagination || pagination.totalPages <= 1) return null;
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between px-1 pt-4 text-sm text-slate-600 border-t border-slate-100 mt-4">
      <span className="min-w-0 truncate">
        Page {pagination.page} of {pagination.totalPages}
        {pagination.total != null && ` · ${pagination.total} ${label}`}
      </span>
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onPageChange((p) => p - 1)}>
          Previous
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={page >= pagination.totalPages}
          onClick={() => onPageChange((p) => p + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}

interface QuickActionCardProps {
  label: string;
  desc: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  onClick: () => void;
  disabled?: boolean;
}

export function QuickActionCard({
  label,
  desc,
  icon: Icon,
  color,
  onClick,
  disabled = false,
}: QuickActionCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={disabled ? 'View only on dashboard — open from your assigned menu' : undefined}
      className={clsx(
        'quick-action-card flex flex-col items-start gap-2 p-2.5 sm:flex-row sm:items-center sm:gap-4 sm:p-4 rounded-xl sm:rounded-2xl border border-primary-100/90 bg-white text-left transition-all w-full active:scale-[0.98]',
        color,
        disabled
          ? 'opacity-60 cursor-not-allowed'
          : 'hover:border-primary-300 hover:bg-primary-50/60 hover:shadow-sm'
      )}
    >
      <div className="flex h-9 w-9 sm:h-11 sm:w-11 items-center justify-center rounded-xl sm:rounded-2xl bg-primary-50 text-primary-600 shadow-sm">
        <Icon className="h-4 w-4 sm:h-5 sm:w-5" />
      </div>
      <div className="flex-1 min-w-0 w-full">
        <p className="font-semibold text-slate-900 text-xs sm:text-sm leading-snug">{label}</p>
        <p className="text-[10px] sm:text-xs text-slate-500 mt-0.5 line-clamp-2">{desc}</p>
      </div>
      <ChevronRight className="hidden sm:block h-4 w-4 text-slate-400 shrink-0" />
    </button>
  );
}

export function QuickActionGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-2 xl:grid-cols-4 gap-2 sm:gap-3 min-w-0">
      {children}
    </div>
  );
}


/** Responsive stat cards — equal width without stretching to viewport height. */
export function StatGrid({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={clsx(
        'grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-2 sm:gap-3 w-full mb-3 sm:mb-4 min-w-0',
        className
      )}
    >
      {children}
    </div>
  );
}

export function FormActions({
  onCancel,
  submitLabel = 'Save',
  loading,
  cancelLabel = 'Cancel',
  className,
}: {
  onCancel: () => void;
  submitLabel?: string;
  loading?: boolean;
  cancelLabel?: string;
  className?: string;
}) {
  return (
    <div className={clsx('flex justify-end gap-3', className)}>
      <Button type="button" variant="secondary" onClick={onCancel}>{cancelLabel}</Button>
      <Button type="submit" loading={loading}>{submitLabel}</Button>
    </div>
  );
}

export function SectionTitle({ children, className }: { children: React.ReactNode; className?: string }) {
  return <h3 className={clsx('text-sm font-semibold text-slate-800 mb-2', className)}>{children}</h3>;
}

export function formatDate(date: string) {
  if (!date) return '—';
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleDateString('en-KE', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function formatDateTime(date: string) {
  if (!date) return '—';
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleString('en-KE', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatCurrency(amount: number, currency = 'KES') {
  return new Intl.NumberFormat('en-KE', { style: 'currency', currency }).format(amount);
}

export function getStatusBadge(status: string) {
  const map: Record<string, 'default' | 'success' | 'warning' | 'danger' | 'info'> = {
    ACTIVE: 'success',
    COMPLETED: 'success',
    PAID: 'success',
    PASSED: 'success',
    DELIVERED: 'success',
    APPROVED: 'success',
    PENDING: 'warning',
    IN_PROGRESS: 'info',
    IN_PRODUCTION: 'info',
    PARTIAL: 'warning',
    DRAFT: 'default',
    CANCELLED: 'danger',
    REJECTED: 'danger',
    FAILED: 'danger',
    OVERDUE: 'danger',
    UNPAID: 'warning',
  };
  return map[status] || 'default';
}

export { ConfirmDialog, QueryErrorAlert, getApiErrorMessage } from './ConfirmDialog';
export { PageQueryStatus } from './PageQueryStatus';
export { ErrorBoundary } from './ErrorBoundary';
export { Modal, ModalFormBody } from './Modal';
