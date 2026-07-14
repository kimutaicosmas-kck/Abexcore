import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { financeApi } from '../services/api';
import { PageHeader, Card, Button, formatCurrency } from '../components/ui';
import { BarChart3, Users, Factory, Truck, Download } from 'lucide-react';
import { downloadFile } from '../utils/download';
import { FinancialStatementsPanel } from '../components/reports/FinancialStatementsPanel';

export function ReportsPage() {
  const [downloading, setDownloading] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<'overview' | 'financial'>('overview');

  const { data: summary } = useQuery({
    queryKey: ['reports-summary'],
    queryFn: () => financeApi.reportsSummary().then((r) => r.data.data),
  });

  const handleExport = async (type: 'sales' | 'inventory', filename: string) => {
    setDownloading(type);
    try {
      await downloadFile(`/api/v1/finance/reports/${type}/excel`, filename);
    } finally {
      setDownloading(null);
    }
  };

  const reportTypes = [
    {
      name: 'Sales Report',
      description: 'Sales by period, customer, product',
      icon: BarChart3,
      exportType: 'sales' as const,
      filename: 'sales-report.xlsx',
    },
    {
      name: 'Inventory Report',
      description: 'Stock levels, movements, valuation',
      icon: Factory,
      exportType: 'inventory' as const,
      filename: 'inventory-report.xlsx',
    },
    { name: 'Purchase Report', description: 'Purchases by supplier, material', icon: Truck },
    { name: 'Production Report', description: 'Output, consumption, efficiency', icon: Factory },
    { name: 'Financial Statements', description: 'P&L, Balance Sheet, Cash Flow', icon: BarChart3 },
    { name: 'Customer Report', description: 'Customer activity, credit, aging', icon: Users },
    { name: 'VAT Report', description: 'VAT input/output summary', icon: BarChart3 },
    { name: 'Quality Report', description: 'Inspection results, defect trends', icon: Factory },
  ];

  return (
    <div>
      <PageHeader
        title="Reports & Analytics"
        subtitle="Business intelligence and exportable reports (v2.0)"
        action={
          <div className="flex gap-2">
            <Button
              variant={activeSection === 'overview' ? 'primary' : 'secondary'}
              onClick={() => setActiveSection('overview')}
            >
              Overview
            </Button>
            <Button
              variant={activeSection === 'financial' ? 'primary' : 'secondary'}
              onClick={() => setActiveSection('financial')}
            >
              Financial Statements
            </Button>
            <Button
              variant="secondary"
              loading={downloading === 'sales'}
              onClick={() => handleExport('sales', 'sales-report.xlsx')}
            >
              <Download className="h-4 w-4 mr-2" />
              Export Sales
            </Button>
            <Button
              variant="secondary"
              loading={downloading === 'inventory'}
              onClick={() => handleExport('inventory', 'inventory-report.xlsx')}
            >
              <Download className="h-4 w-4 mr-2" />
              Export Inventory
            </Button>
          </div>
        }
      />

      {activeSection === 'financial' ? (
        <FinancialStatementsPanel />
      ) : (
        <>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <Card>
          <p className="text-sm text-gray-500">Total Sales</p>
          <p className="text-2xl font-bold">{formatCurrency(summary?.totalSales || 0)}</p>
        </Card>
        <Card>
          <p className="text-sm text-gray-500">Total Purchases</p>
          <p className="text-2xl font-bold">{formatCurrency(summary?.totalPurchases || 0)}</p>
        </Card>
        <Card>
          <p className="text-sm text-gray-500">Customers</p>
          <p className="text-2xl font-bold">{summary?.totalCustomers || 0}</p>
        </Card>
        <Card>
          <p className="text-sm text-gray-500">Production Completed</p>
          <p className="text-2xl font-bold">{summary?.completedProduction || 0}</p>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {reportTypes.map((report) => (
          <Card key={report.name} className="hover:shadow-md transition-shadow">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-primary-100 rounded-lg">
                <report.icon className="h-5 w-5 text-primary-600" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-sm">{report.name}</h3>
                <p className="text-xs text-gray-500 mt-1">{report.description}</p>
                {'exportType' in report && report.exportType && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="mt-2 -ml-2"
                    loading={downloading === report.exportType}
                    onClick={() => handleExport(report.exportType!, report.filename!)}
                  >
                    <Download className="h-3 w-3 mr-1" /> Excel
                  </Button>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>
        </>
      )}
    </div>
  );
}
