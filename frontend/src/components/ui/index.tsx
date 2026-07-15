import { useId } from 'react';
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
          'bg-white text-slate-700 border border-border hover:bg-surface-muted hover:border-border-strong focus:ring-primary-500 shadow-sm': variant === 'secondary',
          'bg-red-600 text-white hover:bg-red-700 shadow-sm shadow-red-600/20 focus:ring-red-500': variant === 'danger',
          'text-slate-600 hover:bg-surface-subtle focus:ring-slate-400': variant === 'ghost',
          'px-3 py-1.5 text-sm': size === 'sm',
          'px-4 py-2.5 text-sm': size === 'md',
          'px-6 py-3 text-base': size === 'lg',
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
          'block w-full rounded-xl border border-border bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-500/15 transition-all',
          error && 'border-red-400 focus:border-red-400 focus:ring-red-500/15',
          className
        )}
        {...props}
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  options: { value: string; label: string }[];
}

export function Select({ label, error, options, className, ...props }: SelectProps) {
  return (
    <div className="space-y-1.5">
      {label && <label className="block text-sm font-medium text-slate-700">{label}</label>}
      <select
        className={clsx(
          'block w-full rounded-xl border border-border bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-500/15 transition-all',
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
    <div className={clsx('bg-white rounded-2xl border border-border shadow-soft overflow-hidden', className)}>
      {(title || action) && (
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-surface-muted/40">
          {title && <h3 className="text-sm font-semibold text-slate-900">{title}</h3>}
          {action}
        </div>
      )}
      <div className={padding ? 'p-4' : undefined}>{children}</div>
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
      className={clsx('inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ring-1 ring-inset', {
        'bg-slate-100 text-slate-700 ring-slate-200': variant === 'default',
        'bg-emerald-50 text-emerald-700 ring-emerald-200': variant === 'success',
        'bg-amber-50 text-amber-700 ring-amber-200': variant === 'warning',
        'bg-red-50 text-red-700 ring-red-200': variant === 'danger',
        'bg-sky-50 text-sky-700 ring-sky-200': variant === 'info',
      })}
    >
      {children}
    </span>
  );
}

interface StatCardProps {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  trend?: { value: number; label: string };
  color?: string;
}

export function StatCard({ title, value, icon, trend, color = 'from-primary-500 to-primary-600' }: StatCardProps) {
  return (
    <div className="rounded-xl border border-border bg-white p-3.5 shadow-soft">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-500">{title}</p>
          <p className="mt-1 text-xl font-bold tracking-tight text-slate-900 truncate">{value}</p>
          {trend && (
            <p className={clsx('mt-0.5 text-xs font-medium', trend.value >= 0 ? 'text-emerald-600' : 'text-red-600')}>
              {trend.value >= 0 ? '+' : ''}{trend.value}% {trend.label}
            </p>
          )}
        </div>
        <div className={clsx('p-2 rounded-lg bg-gradient-to-br text-white shrink-0', color)}>
          {icon}
        </div>
      </div>
    </div>
  );
}

interface TableProps {
  columns: { key: string; label: string; render?: (value: unknown, row: Record<string, unknown>) => React.ReactNode }[];
  data: Record<string, unknown>[] | object[];
  loading?: boolean;
  onRowClick?: (row: Record<string, unknown>) => void;
  embedded?: boolean;
}

export function Table({ columns, data, loading, onRowClick, embedded = false }: TableProps) {
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
      <div className="overflow-x-auto">
        <table className="min-w-full">
          <thead>
            <tr className="border-b border-border bg-surface-muted/60">
              {columns.map((col) => (
                <th
                  key={col.key}
                  className="px-5 py-3.5 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wider"
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
                    onRowClick ? 'cursor-pointer hover:bg-primary-50/40' : 'hover:bg-surface-muted/50'
                  )}
                  onClick={() => onRowClick?.(record)}
                >
                  {columns.map((col) => (
                    <td key={col.key} className="px-5 py-4 whitespace-nowrap text-sm text-slate-800">
                      {col.render ? col.render(record[col.key], record) : String(record[col.key] ?? '')}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  })();

  if (embedded) return content;

  return (
    <div className="bg-white rounded-2xl border border-border shadow-soft overflow-hidden">
      {content}
    </div>
  );
}

export function DataPanel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={clsx('bg-white rounded-2xl border border-border shadow-soft overflow-hidden', className)}>
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
    <div className={clsx('inline-flex flex-wrap gap-0.5 p-0.5 rounded-lg bg-slate-100 border border-slate-200', className)}>
      {tabs.map((tab, i) => (
        <button
          key={tab}
          onClick={() => onChange(i)}
          className={clsx(
            'px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
            activeIndex === i
              ? 'bg-white text-primary-700 shadow-sm'
              : 'text-slate-600 hover:text-slate-900'
          )}
        >
          {tab}
        </button>
      ))}
    </div>
  );
}

export function PageHeader({ title, subtitle, action }: { title?: string; subtitle?: string; action?: React.ReactNode }) {
  if (!title && !subtitle && !action) return null;
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-3">
      {(title || subtitle) && (
        <div className="min-w-0">
          {title && <h2 className="text-lg font-semibold text-slate-900">{title}</h2>}
          {subtitle && <p className="text-xs text-slate-500 truncate">{subtitle}</p>}
        </div>
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
    <div className={clsx('flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-3', className)}>
      {tabs && onTabChange && (
        <TabGroup tabs={tabs} activeIndex={activeTab} onChange={onTabChange} className="!mb-0" />
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
          'block w-full rounded-xl border border-border bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-500/15 transition-all resize-y min-h-[80px]',
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
          'bg-sky-50 text-sky-800 ring-sky-200': variant === 'info',
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
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center rounded-xl border border-dashed border-slate-200 bg-slate-50/50">
      <div className="h-10 w-10 rounded-xl bg-slate-100 flex items-center justify-center mb-3 text-slate-400 text-lg">—</div>
      <p className="text-sm font-medium text-slate-700">{title}</p>
      {description && <p className="text-xs text-slate-500 mt-1 max-w-sm">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
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
    <div className="flex items-center justify-between px-1 pt-4 text-sm text-slate-600 border-t border-slate-100 mt-4">
      <span>
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
}

export function QuickActionCard({ label, desc, icon: Icon, color, onClick }: QuickActionCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-4 p-4 rounded-xl border text-left transition-all hover:shadow-md hover:-translate-y-0.5 ${color}`}
    >
      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/80">
        <Icon className="h-5 w-5" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-slate-900">{label}</p>
        <p className="text-xs text-slate-500 mt-0.5">{desc}</p>
      </div>
      <ChevronRight className="h-4 w-4 text-slate-400 shrink-0" />
    </button>
  );
}

export function QuickActionGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">{children}</div>;
}

export function FormActions({ onCancel, submitLabel = 'Save', loading, cancelLabel = 'Cancel' }: {
  onCancel: () => void;
  submitLabel?: string;
  loading?: boolean;
  cancelLabel?: string;
}) {
  return (
    <div className="flex justify-end gap-2 pt-4 border-t border-slate-200">
      <Button type="button" variant="secondary" onClick={onCancel}>{cancelLabel}</Button>
      <Button type="submit" loading={loading}>{submitLabel}</Button>
    </div>
  );
}

export function SectionTitle({ children, className }: { children: React.ReactNode; className?: string }) {
  return <h3 className={clsx('text-sm font-semibold text-slate-800 mb-2', className)}>{children}</h3>;
}

export function formatCurrency(amount: number, currency = 'KES') {
  return new Intl.NumberFormat('en-KE', { style: 'currency', currency }).format(amount);
}

export function formatDate(date: string) {
  return new Date(date).toLocaleDateString('en-KE', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
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
