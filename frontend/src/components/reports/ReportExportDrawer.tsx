import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, Eye, FileSpreadsheet, FileText, SlidersHorizontal, X } from 'lucide-react';
import {
  ReportDefinition,
  ReportExportFormat,
  ReportFilterField,
} from '../../config/reportCatalog';
import { inventoryApi, reportsApi } from '../../services/api';
import { downloadFile } from '../../utils/download';
import { Alert, Button, Input, Select } from '../ui';
import { SalesOfficerOption } from '../../types';

type WarehouseOption = { id: string; name: string; code: string };

export type ReportFilterValues = Partial<
  Record<
    ReportFilterField,
    string
  >
>;

function startOfMonthInput() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function todayInput() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function defaultFilters(report: ReportDefinition): ReportFilterValues {
  const values: ReportFilterValues = {};
  if (report.filters.includes('startDate')) values.startDate = startOfMonthInput();
  if (report.filters.includes('endDate')) values.endDate = todayInput();
  if (report.filters.includes('itemType')) values.itemType = 'ALL';
  if (report.filters.includes('qualityStatus')) values.qualityStatus = 'ALL';
  return values;
}

function buildExportParams(report: ReportDefinition, filters: ReportFilterValues) {
  const params: Record<string, string | undefined> = {};
  if (report.vatScope) params.vatStatus = report.vatScope;
  for (const key of report.filters) {
    const value = filters[key];
    if (value !== undefined && value !== '') {
      if (key === 'needsRestockOnly' || key === 'lowStockOnly') {
        params[key] = value === 'true' ? 'true' : undefined;
      } else {
        params[key] = value;
      }
    }
  }
  return params;
}

type ReportExportDrawerProps = {
  report: ReportDefinition | null;
  open: boolean;
  onClose: () => void;
  canExport: boolean;
  onOpenPanel?: (section: 0 | 1 | 2 | 3) => void;
  onOpenDetail?: (detailKey: string) => void;
};

export function ReportExportDrawer({
  report,
  open,
  onClose,
  canExport,
  onOpenPanel,
  onOpenDetail,
}: ReportExportDrawerProps) {
  const [filters, setFilters] = useState<ReportFilterValues>({});
  const [format, setFormat] = useState<ReportExportFormat>('excel');
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (report) {
      setFilters(defaultFilters(report));
      setFormat(report.formats[0] || 'excel');
      setError(null);
    }
  }, [report]);

  const { data: officers } = useQuery({
    queryKey: ['sales-officers'],
    queryFn: () => reportsApi.salesOfficers().then((r) => r.data.data as SalesOfficerOption[]),
    enabled: open && !!report?.filters.includes('salesPersonId'),
  });

  const { data: warehouses } = useQuery({
    queryKey: ['warehouses'],
    queryFn: () => inventoryApi.warehouses().then((r) => r.data.data as WarehouseOption[]),
    enabled: open && !!report?.filters.includes('warehouseId'),
  });

  const officerOptions = useMemo(
    () => [
      { value: '', label: 'All salespeople' },
      ...(officers || []).map((o) => ({ value: o.id, label: o.name })),
    ],
    [officers]
  );

  const warehouseOptions = useMemo(
    () => [
      { value: '', label: 'All warehouses' },
      ...(warehouses || []).map((w) => ({ value: w.id, label: `${w.code} — ${w.name}` })),
    ],
    [warehouses]
  );

  if (!open || !report) return null;

  const updateFilter = (key: ReportFilterField, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const handleExport = async () => {
    if (!canExport || !report.exportPaths?.[format]) return;
    setExporting(true);
    setError(null);
    try {
      const path = report.exportPaths[format]!;
      const filename = report.exportFilename?.[format] || `${report.id}-report.${format === 'pdf' ? 'pdf' : 'xlsx'}`;
      await downloadFile(path, filename, buildExportParams(report, filters));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  const showFilters = report.filters.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" className="absolute inset-0 bg-slate-900/40 backdrop-blur-[1px]" onClick={onClose} aria-label="Close" />
      <aside className="relative flex h-full w-full max-w-md flex-col bg-white shadow-2xl border-l border-slate-200 animate-in slide-in-from-right duration-200">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-primary-600">Configure report</p>
            <h2 className="text-lg font-semibold text-slate-900 truncate">{report.name}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {showFilters && (
            <section className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
                <SlidersHorizontal className="h-4 w-4 text-primary-600" />
                Filters
              </div>
              <div className="grid grid-cols-1 gap-3 rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                {report.filters.includes('startDate') && (
                  <Input
                    label="From date"
                    type="date"
                    value={filters.startDate || ''}
                    onChange={(e) => updateFilter('startDate', e.target.value)}
                  />
                )}
                {report.filters.includes('endDate') && (
                  <Input
                    label="To date"
                    type="date"
                    value={filters.endDate || ''}
                    onChange={(e) => updateFilter('endDate', e.target.value)}
                  />
                )}
                {report.filters.includes('salesPersonId') && (
                  <Select
                    label="Sales person"
                    options={officerOptions}
                    value={filters.salesPersonId || ''}
                    onChange={(e) => updateFilter('salesPersonId', e.target.value)}
                  />
                )}
                {report.filters.includes('status') && (
                  <Select
                    label="Invoice status"
                    value={filters.status || ''}
                    onChange={(e) => updateFilter('status', e.target.value)}
                    options={[
                      { value: '', label: 'All statuses' },
                      { value: 'PAID', label: 'Paid' },
                      { value: 'UNPAID', label: 'Unpaid' },
                      { value: 'PARTIAL', label: 'Partial' },
                      { value: 'OVERDUE', label: 'Overdue' },
                      { value: 'DRAFT', label: 'Draft' },
                      { value: 'CANCELLED', label: 'Cancelled' },
                    ]}
                  />
                )}
                {report.filters.includes('search') && (
                  <Input
                    label="Product search"
                    placeholder="Name or part number"
                    value={filters.search || ''}
                    onChange={(e) => updateFilter('search', e.target.value)}
                  />
                )}
                {report.filters.includes('needsRestockOnly') && (
                  <Select
                    label="Restock filter"
                    value={filters.needsRestockOnly || ''}
                    onChange={(e) => updateFilter('needsRestockOnly', e.target.value === 'true' ? 'true' : '')}
                    options={[
                      { value: '', label: 'All products sold' },
                      { value: 'true', label: 'Needs restock only' },
                    ]}
                  />
                )}
                {report.filters.includes('warehouseId') && (
                  <Select
                    label="Warehouse"
                    options={warehouseOptions}
                    value={filters.warehouseId || ''}
                    onChange={(e) => updateFilter('warehouseId', e.target.value)}
                  />
                )}
                {report.filters.includes('itemType') && (
                  <Select
                    label="Item type"
                    value={filters.itemType || 'ALL'}
                    onChange={(e) => updateFilter('itemType', e.target.value)}
                    options={[
                      { value: 'ALL', label: 'All items' },
                      { value: 'PRODUCT', label: 'Finished goods' },
                      { value: 'RAW_MATERIAL', label: 'Raw materials' },
                    ]}
                  />
                )}
                {report.filters.includes('lowStockOnly') && (
                  <Select
                    label="Stock level"
                    value={filters.lowStockOnly || ''}
                    onChange={(e) => updateFilter('lowStockOnly', e.target.value === 'true' ? 'true' : '')}
                    options={[
                      { value: '', label: 'All stock levels' },
                      { value: 'true', label: 'Low stock only' },
                    ]}
                  />
                )}
                {report.filters.includes('qualityStatus') && (
                  <Select
                    label="Inspection result"
                    value={filters.qualityStatus || 'ALL'}
                    onChange={(e) => updateFilter('qualityStatus', e.target.value)}
                    options={[
                      { value: 'ALL', label: 'All inspections' },
                      { value: 'PASSED', label: 'Passed only' },
                      { value: 'FAILED', label: 'Failed only' },
                    ]}
                  />
                )}
              </div>
            </section>
          )}

          {report.formats.length > 0 && report.exportPaths && (
            <section className="space-y-3">
              <p className="text-sm font-medium text-slate-700">Export format</p>
              <div className="grid grid-cols-2 gap-2">
                {report.formats.includes('excel') && (
                  <button
                    type="button"
                    onClick={() => setFormat('excel')}
                    className={`flex items-center gap-2 rounded-xl border px-3 py-3 text-left text-sm transition ${
                      format === 'excel'
                        ? 'border-primary-300 bg-primary-50 text-primary-800 ring-2 ring-primary-200'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    <FileSpreadsheet className="h-5 w-5 shrink-0" />
                    <div>
                      <p className="font-semibold">Excel</p>
                      <p className="text-xs text-slate-500">Spreadsheet (.xlsx)</p>
                    </div>
                  </button>
                )}
                {report.formats.includes('pdf') && (
                  <button
                    type="button"
                    onClick={() => setFormat('pdf')}
                    className={`flex items-center gap-2 rounded-xl border px-3 py-3 text-left text-sm transition ${
                      format === 'pdf'
                        ? 'border-primary-300 bg-primary-50 text-primary-800 ring-2 ring-primary-200'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    <FileText className="h-5 w-5 shrink-0" />
                    <div>
                      <p className="font-semibold">PDF</p>
                      <p className="text-xs text-slate-500">Print-ready document</p>
                    </div>
                  </button>
                )}
              </div>
            </section>
          )}

          {error && <Alert variant="error">{error}</Alert>}
          {!canExport && (
            <Alert variant="info">You need report access permission to download exports.</Alert>
          )}
        </div>

        <div className="border-t border-slate-100 px-5 py-4 space-y-2 bg-white">
          {report.exportPaths && (
            <Button
              className="w-full"
              loading={exporting}
              disabled={!canExport}
              onClick={handleExport}
            >
              <Download className="h-4 w-4 mr-1.5" />
              Download {format === 'pdf' ? 'PDF' : 'Excel'}
            </Button>
          )}
          {report.panelSection !== undefined && onOpenPanel && (
            <Button
              variant="secondary"
              className="w-full"
              onClick={() => {
                onOpenPanel(report.panelSection as 0 | 1 | 2 | 3);
                onClose();
              }}
            >
              <Eye className="h-4 w-4 mr-1.5" />
              Open interactive report
            </Button>
          )}
          {report.detailKey && onOpenDetail && (
            <Button
              variant="secondary"
              className="w-full"
              onClick={() => {
                onOpenDetail(report.detailKey!);
                onClose();
              }}
            >
              <Eye className="h-4 w-4 mr-1.5" />
              Preview in app
            </Button>
          )}
        </div>
      </aside>
    </div>
  );
}
