import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, Users } from 'lucide-react';
import { reportsApi } from '../../services/api';
import {
  Alert,
  Badge,
  Button,
  Card,
  DataPanel,
  Input,
  Select,
  StatCard,
  StatGrid,
  Table,
  TablePagination,
  formatCurrency,
  formatDate,
  getStatusBadge,
} from '../ui';
import { SalesByPersonReport, SalesOfficerOption } from '../../types';
import { downloadFile } from '../../utils/download';

export function SalesByPersonPanel() {
  const [page, setPage] = useState(1);
  const [salesPersonId, setSalesPersonId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [exporting, setExporting] = useState(false);

  const { data: officers } = useQuery({
    queryKey: ['sales-officers'],
    queryFn: () => reportsApi.salesOfficers().then((r) => r.data.data as SalesOfficerOption[]),
  });

  const { data: report, isLoading, isError, refetch } = useQuery({
    queryKey: ['sales-by-person', page, salesPersonId, startDate, endDate],
    queryFn: () =>
      reportsApi
        .salesByPerson({
          page,
          limit: 15,
          salesPersonId: salesPersonId || undefined,
          startDate: startDate || undefined,
          endDate: endDate || undefined,
        })
        .then((r) => r.data.data as SalesByPersonReport),
  });

  const officerOptions = [
    { value: '', label: 'All salespeople' },
    ...(officers || []).map((officer) => ({ value: officer.id, label: officer.name })),
  ];

  const handleExport = async () => {
    setExporting(true);
    try {
      await downloadFile('/finance/reports/sales-by-person/excel', 'sales-by-salesperson.xlsx', {
        salesPersonId: salesPersonId || undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      });
    } finally {
      setExporting(false);
    }
  };

  const columns = [
    { key: 'invoiceNumber', label: 'Invoice #' },
    { key: 'orderNumber', label: 'Order #' },
    {
      key: 'invoiceDate',
      label: 'Date',
      render: (val: unknown) => formatDate(val as string),
    },
    { key: 'salesPersonName', label: 'Sales Person' },
    {
      key: 'customerName',
      label: 'Customer',
      render: (_: unknown, row: Record<string, unknown>) => (
        <div>
          <p className="font-medium">{row.customerName as string}</p>
          {(row.customerCode as string) && (
            <p className="text-xs text-slate-500">{row.customerCode as string}</p>
          )}
        </div>
      ),
    },
    {
      key: 'totalAmount',
      label: 'Amount',
      render: (val: unknown) => <span className="font-semibold tabular-nums">{formatCurrency(val as number)}</span>,
    },
    {
      key: 'paidAmount',
      label: 'Paid',
      render: (val: unknown) => <span className="tabular-nums">{formatCurrency(val as number)}</span>,
    },
    {
      key: 'status',
      label: 'Status',
      render: (val: unknown) => <Badge variant={getStatusBadge(val as string)}>{String(val).replace(/_/g, ' ')}</Badge>,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 flex-1">
          <Select
            label="Sales person"
            options={officerOptions}
            value={salesPersonId}
            onChange={(e) => {
              setSalesPersonId(e.target.value);
              setPage(1);
            }}
          />
          <Input
            label="From date"
            type="date"
            value={startDate}
            onChange={(e) => {
              setStartDate(e.target.value);
              setPage(1);
            }}
          />
          <Input
            label="To date"
            type="date"
            value={endDate}
            onChange={(e) => {
              setEndDate(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <Button onClick={handleExport} loading={exporting} className="shrink-0">
          <Download className="h-4 w-4 mr-1.5" />
          Export Excel
        </Button>
      </div>

      {report && (
        <>
          <StatGrid>
            <StatCard
              title="Invoices"
              value={report.summary.invoiceCount}
              icon={<Users className="h-5 w-5 text-white" />}
              color="from-primary-500 to-indigo-600"
            />
            <StatCard
              title="Total sales"
              value={formatCurrency(report.summary.totalSales)}
              icon={<Users className="h-5 w-5 text-white" />}
              color="from-emerald-500 to-teal-600"
            />
            <StatCard
              title="Collected"
              value={formatCurrency(report.summary.totalPaid)}
              icon={<Users className="h-5 w-5 text-white" />}
              color="from-violet-500 to-purple-600"
            />
            <StatCard
              title="Outstanding"
              value={formatCurrency(report.summary.outstanding)}
              icon={<Users className="h-5 w-5 text-white" />}
              color="from-amber-500 to-orange-600"
            />
          </StatGrid>

          {!salesPersonId && report.summary.bySalesPerson.length > 0 && (
            <Card title="Totals by sales person" padding={false}>
              <ul className="divide-y divide-slate-100">
                {report.summary.bySalesPerson.map((person) => (
                  <li key={person.id} className="flex items-center justify-between px-4 py-3 text-sm">
                    <div>
                      <p className="font-medium text-slate-900">{person.name}</p>
                      <p className="text-xs text-slate-500">{person.invoiceCount} invoices</p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold tabular-nums">{formatCurrency(person.totalSales)}</p>
                      <p className="text-xs text-slate-500">Paid {formatCurrency(person.totalPaid)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}

      <DataPanel>
        {isError ? (
          <Alert variant="error">
            Failed to load sales report.{' '}
            <button type="button" onClick={() => refetch()} className="underline font-medium">
              Retry
            </button>
          </Alert>
        ) : (
          <>
            <Table
              columns={columns}
              data={(report?.rows || []) as unknown as Record<string, unknown>[]}
              loading={isLoading}
              embedded
            />
            {report && (
              <TablePagination
                pagination={report.pagination}
                page={page}
                onPageChange={setPage}
                label="invoices"
              />
            )}
          </>
        )}
      </DataPanel>
    </div>
  );
}
