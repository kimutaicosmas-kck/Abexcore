import { Select } from '../ui';

export const SALES_ORDER_PERIOD_OPTIONS = [
  { value: 'today', label: 'Today' },
  { value: 'this_month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'all', label: 'All dates' },
  { value: 'month', label: 'By month…' },
  { value: 'day', label: 'By day…' },
] as const;

export type SalesOrderPeriod = (typeof SALES_ORDER_PERIOD_OPTIONS)[number]['value'];

export const SALES_PERF_PERIOD_OPTIONS = [
  { value: 'this_month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'custom', label: 'Custom range…' },
] as const;

export type SalesPerfPeriod = (typeof SALES_PERF_PERIOD_OPTIONS)[number]['value'];

export function SalesOrderPeriodSelect({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (value: SalesOrderPeriod) => void;
  className?: string;
}) {
  return (
    <Select
      aria-label="Period"
      options={[...SALES_ORDER_PERIOD_OPTIONS]}
      value={value}
      onChange={(e) => onChange(e.target.value as SalesOrderPeriod)}
      className={className}
    />
  );
}

export function SalesPerfPeriodSelect({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (value: SalesPerfPeriod) => void;
  className?: string;
}) {
  return (
    <Select
      aria-label="Period"
      options={[...SALES_PERF_PERIOD_OPTIONS]}
      value={value}
      onChange={(e) => onChange(e.target.value as SalesPerfPeriod)}
      className={className}
    />
  );
}
