import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, FileBarChart } from 'lucide-react';
import { financeApi } from '../../services/api';
import {
  FINANCE_REPORT_CATALOG,
  FINANCE_REPORT_CATEGORIES,
  FinanceReportCategory,
  FinanceReportDefinition,
  getFinanceReportById,
} from '../../config/financeReportCatalog';
import { Alert, Button, Input, formatCurrency } from '../ui';
import { getApiErrorMessage } from '../../utils/apiError';

function todayInput() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function monthStartInput() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

type ReportPayload = {
  reportId: string;
  title: string;
  period?: { start?: string; end?: string; asOf?: string };
  columns: { key: string; label: string; align?: 'left' | 'right' }[];
  rows: Record<string, unknown>[];
  summary?: Record<string, unknown>;
  notice?: string;
};

function formatCell(key: string, value: unknown) {
  if (value == null || value === '') return '—';
  if (typeof value === 'number' && /amount|total|balance|debit|credit|revenue|net|inflow|outflow|profit|worth|activity|paid/i.test(key)) {
    return formatCurrency(value);
  }
  return String(value);
}

export function FinanceReportsPanel() {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<FinanceReportCategory | 'all'>('all');
  const [selected, setSelected] = useState<FinanceReportDefinition | null>(null);
  const [start, setStart] = useState(monthStartInput());
  const [end, setEnd] = useState(todayInput());
  const [asOf, setAsOf] = useState(todayInput());
  const [accountCode, setAccountCode] = useState('1200');
  const [runKey, setRunKey] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return FINANCE_REPORT_CATALOG.filter((r) => {
      if (category !== 'all' && r.category !== category) return false;
      if (!q) return true;
      return r.name.toLowerCase().includes(q) || r.id.includes(q);
    });
  }, [search, category]);

  const { data, isFetching, isError, error } = useQuery({
    queryKey: ['finance-module-report', runKey],
    queryFn: () => {
      if (!runKey) throw new Error('No report');
      const id = runKey.split('|')[0]!;
      const def = getFinanceReportById(id);
      return financeApi
        .moduleReport(id, {
          start: def?.usesAsOf ? undefined : start,
          end: def?.usesAsOf ? undefined : end,
          asOf: def?.usesAsOf ? asOf : undefined,
          accountCode: def?.needsAccountCode ? accountCode : undefined,
        })
        .then((r) => r.data.data as ReportPayload);
    },
    enabled: Boolean(runKey),
  });

  const grouped = useMemo(() => {
    const map = new Map<FinanceReportCategory, FinanceReportDefinition[]>();
    for (const cat of FINANCE_REPORT_CATEGORIES) map.set(cat.id, []);
    for (const r of filtered) map.get(r.category)?.push(r);
    return map;
  }, [filtered]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 min-h-[480px]">
      <div className="lg:col-span-4 space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search reports…"
            className="w-full rounded-xl border border-primary-100 bg-white py-2 pl-9 pr-3 text-sm"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setCategory('all')}
            className={`rounded-lg px-2.5 py-1 text-xs font-medium ${category === 'all' ? 'bg-primary-600 text-white' : 'bg-slate-100 text-slate-600'}`}
          >
            All
          </button>
          {FINANCE_REPORT_CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCategory(c.id)}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium ${category === c.id ? 'bg-primary-600 text-white' : 'bg-slate-100 text-slate-600'}`}
            >
              {c.label}
            </button>
          ))}
        </div>
        <div className="rounded-xl border border-slate-200 bg-white max-h-[520px] overflow-y-auto divide-y divide-slate-100">
          {FINANCE_REPORT_CATEGORIES.map((cat) => {
            const items = grouped.get(cat.id) || [];
            if (category !== 'all' && category !== cat.id) return null;
            if (items.length === 0) return null;
            return (
              <div key={cat.id}>
                <p className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 bg-slate-50 sticky top-0">
                  {cat.label}
                </p>
                {items.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => {
                      setSelected(r);
                      setRunKey(null);
                    }}
                    className={`w-full text-left px-3 py-2.5 text-sm hover:bg-primary-50/80 ${selected?.id === r.id ? 'bg-primary-50 font-medium text-primary-800' : 'text-slate-800'}`}
                  >
                    {r.name}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      <div className="lg:col-span-8 rounded-xl border border-slate-200 bg-white p-4 flex flex-col min-h-[480px]">
        {!selected ? (
          <div className="flex flex-1 flex-col items-center justify-center text-slate-500 gap-2">
            <FileBarChart className="h-10 w-10 text-slate-300" />
            <p className="text-sm">Select a report from the list (QuickBooks-style catalog).</p>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-3 mb-3">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">{selected.name}</h3>
                <p className="text-xs text-slate-500 mt-0.5">{selected.id}</p>
              </div>
              <Button
                size="sm"
                loading={isFetching}
                onClick={() => setRunKey(`${selected.id}|${Date.now()}`)}
              >
                Run report
              </Button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
              {!selected.usesAsOf && (
                <>
                  <Input label="From" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
                  <Input label="To" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
                </>
              )}
              {selected.usesAsOf && (
                <Input label="As of" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
              )}
              {selected.needsAccountCode && (
                <Input
                  label="Account code"
                  value={accountCode}
                  onChange={(e) => setAccountCode(e.target.value)}
                  placeholder="e.g. 1200"
                />
              )}
            </div>

            {isError && <Alert variant="error">{getApiErrorMessage(error)}</Alert>}
            {data?.notice && (
              <Alert variant="warning" className="mb-3">
                {data.notice}
              </Alert>
            )}

            {isFetching && <p className="text-sm text-slate-500 py-8 text-center">Running report…</p>}

            {!isFetching && data && (
              <div className="flex-1 overflow-auto">
                {data.period && (
                  <p className="text-xs text-slate-500 mb-2">
                    {data.period.asOf
                      ? `As of ${data.period.asOf}`
                      : `Period ${data.period.start || '…'} to ${data.period.end || '…'}`}
                  </p>
                )}
                {data.rows.length === 0 ? (
                  <p className="text-sm text-slate-500 py-6 text-center">No rows for this period.</p>
                ) : (
                  <div className="table-scroll-x">
                    <table className="w-full text-sm min-w-max">
                      <thead>
                        <tr className="border-b text-left text-slate-500">
                          {data.columns.map((col) => (
                            <th key={col.key} className={`py-2 pr-4 ${col.align === 'right' ? 'text-right' : ''}`}>
                              {col.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {data.rows.map((row, idx) => (
                          <tr key={idx} className="border-b border-slate-50">
                            {data.columns.map((col) => (
                              <td
                                key={col.key}
                                className={`py-2 pr-4 tabular-nums ${col.align === 'right' ? 'text-right' : ''}`}
                              >
                                {formatCell(col.key, row[col.key])}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {data.summary && Object.keys(data.summary).length > 0 && (
                  <div className="mt-4 rounded-lg bg-slate-50 p-3 text-xs text-slate-600 space-y-1">
                    {Object.entries(data.summary).map(([k, v]) => (
                      <div key={k} className="flex justify-between gap-4">
                        <span>{k}</span>
                        <span className="font-medium">{String(v)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
