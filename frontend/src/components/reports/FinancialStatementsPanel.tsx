import { useQuery } from '@tanstack/react-query';
import { financeApi } from '../../services/api';
import { Card, formatCurrency } from '../ui';

export function FinancialStatementsPanel() {
  const { data: pl, isLoading: plLoading } = useQuery({
    queryKey: ['profit-loss'],
    queryFn: () => financeApi.profitLoss().then((r) => r.data.data),
  });

  const { data: bs, isLoading: bsLoading } = useQuery({
    queryKey: ['balance-sheet'],
    queryFn: () => financeApi.balanceSheet().then((r) => r.data.data),
  });

  const { data: cf, isLoading: cfLoading } = useQuery({
    queryKey: ['cash-flow'],
    queryFn: () => financeApi.cashFlow().then((r) => r.data.data),
  });

  const { data: vat } = useQuery({
    queryKey: ['vat-report'],
    queryFn: () => financeApi.vatReport().then((r) => r.data.data),
  });

  if (plLoading || bsLoading || cfLoading) {
    return <div className="text-center py-8 text-gray-500">Loading financial statements...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <h3 className="font-semibold text-lg mb-4">Profit & Loss</h3>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between"><dt>Revenue</dt><dd className="font-medium">{formatCurrency(pl?.revenue || 0)}</dd></div>
            <div className="flex justify-between text-red-600"><dt>Cost of Goods Sold</dt><dd>({formatCurrency(pl?.costOfGoodsSold || 0)})</dd></div>
            <div className="flex justify-between border-t pt-2 font-semibold"><dt>Gross Profit</dt><dd>{formatCurrency(pl?.grossProfit || 0)}</dd></div>
            <div className="flex justify-between text-red-600"><dt>Operating Expenses</dt><dd>({formatCurrency(pl?.operatingExpenses || 0)})</dd></div>
            <div className="flex justify-between"><dt>Other Income</dt><dd>{formatCurrency(pl?.otherIncome || 0)}</dd></div>
            <div className="flex justify-between border-t pt-2 text-lg font-bold text-primary-700"><dt>Net Profit</dt><dd>{formatCurrency(pl?.netProfit || 0)}</dd></div>
          </dl>
        </Card>

        <Card>
          <h3 className="font-semibold text-lg mb-4">Balance Sheet</h3>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between font-medium"><dt>Total Assets</dt><dd>{formatCurrency(bs?.totalAssets || 0)}</dd></div>
            <div className="flex justify-between"><dt>Accounts Receivable</dt><dd>{formatCurrency(bs?.accountsReceivable || 0)}</dd></div>
            <div className="flex justify-between font-medium mt-4"><dt>Total Liabilities</dt><dd>{formatCurrency(bs?.totalLiabilities || 0)}</dd></div>
            <div className="flex justify-between"><dt>Accounts Payable</dt><dd>{formatCurrency(bs?.accountsPayable || 0)}</dd></div>
            <div className="flex justify-between font-medium mt-4"><dt>Total Equity</dt><dd>{formatCurrency(bs?.totalEquity || 0)}</dd></div>
            <div className="flex justify-between border-t pt-2 text-xs text-gray-500">
              <dt>Balanced</dt>
              <dd>{bs?.balanced ? 'Yes' : 'Review accounts'}</dd>
            </div>
          </dl>
        </Card>
      </div>

      <Card>
        <h3 className="font-semibold text-lg mb-4">Cash Flow (6 months)</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-gray-500">
                <th className="py-2">Month</th>
                <th className="py-2">Inflow</th>
                <th className="py-2">Outflow</th>
                <th className="py-2">Net</th>
              </tr>
            </thead>
            <tbody>
              {(cf?.months || []).map((m: { month: string; inflow: number; outflow: number; net: number }) => (
                <tr key={m.month} className="border-b border-gray-100">
                  <td className="py-2">{m.month}</td>
                  <td className="py-2 text-green-600">{formatCurrency(m.inflow)}</td>
                  <td className="py-2 text-red-600">{formatCurrency(m.outflow)}</td>
                  <td className={`py-2 font-medium ${m.net >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                    {formatCurrency(m.net)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td className="py-2">Total</td>
                <td className="py-2">{formatCurrency(cf?.totalInflow || 0)}</td>
                <td className="py-2">{formatCurrency(cf?.totalOutflow || 0)}</td>
                <td className="py-2">{formatCurrency(cf?.netCashFlow || 0)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      {vat && (
        <Card>
          <h3 className="font-semibold text-lg mb-4">VAT Summary (Current Period)</h3>
          <dl className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
            <div><dt className="text-gray-500">Output VAT</dt><dd className="font-medium">{formatCurrency(vat.outputVat)}</dd></div>
            <div><dt className="text-gray-500">Input VAT</dt><dd className="font-medium">{formatCurrency(vat.inputVat)}</dd></div>
            <div><dt className="text-gray-500">Net VAT Payable</dt><dd className="font-bold text-primary-700">{formatCurrency(vat.netVatPayable)}</dd></div>
          </dl>
        </Card>
      )}
    </div>
  );
}
