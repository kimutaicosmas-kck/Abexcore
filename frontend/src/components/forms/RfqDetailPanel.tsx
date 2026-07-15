import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { inventoryApi } from '../../services/api';
import { Button, Input, Badge, formatCurrency, getStatusBadge } from '../ui';

interface SupplierQuote {
  id: string;
  supplierId: string;
  totalAmount: number;
  status: string;
  notes?: string;
  supplier: { name: string; code: string };
}

interface RfqDetailProps {
  rfq: {
    id: string;
    rfqNo: string;
    status: string;
    dueDate?: string;
    quotations?: SupplierQuote[];
  };
  onClose: () => void;
}

export function RfqDetailPanel({ rfq, onClose }: RfqDetailProps) {
  const queryClient = useQueryClient();
  const [amounts, setAmounts] = useState<Record<string, string>>(
    Object.fromEntries(
      (rfq.quotations || []).map((q) => [q.id, String(q.totalAmount || '')])
    )
  );

  const saveQuote = useMutation({
    mutationFn: ({ id, totalAmount }: { id: string; totalAmount: number }) =>
      inventoryApi.updateQuotation(id, { totalAmount }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rfqs'] });
      queryClient.invalidateQueries({ queryKey: ['procurement-stats'] });
    },
  });

  const award = useMutation({
    mutationFn: (quotationId: string) => inventoryApi.awardRfq(rfq.id, quotationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rfqs'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      queryClient.invalidateQueries({ queryKey: ['procurement-stats'] });
      onClose();
    },
  });

  const isAwarded = rfq.status === 'APPROVED';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold">{rfq.rfqNo}</h3>
          <Badge variant={getStatusBadge(rfq.status)}>{rfq.status.replace(/_/g, ' ')}</Badge>
        </div>
      </div>

      {!rfq.quotations?.length ? (
        <p className="text-sm text-gray-500">No supplier invitations on this RFQ.</p>
      ) : (
        <div className="space-y-3">
          {rfq.quotations.map((q) => (
            <div key={q.id} className="p-3 border border-gray-200 rounded-lg space-y-2">
              <div className="flex justify-between items-center">
                <span className="font-medium text-sm">{q.supplier.code} — {q.supplier.name}</span>
                <Badge variant={getStatusBadge(q.status)}>{q.status}</Badge>
              </div>
              <div className="flex gap-2 items-end">
                <Input
                  label="Quote Amount (KES)"
                  type="number"
                  min={0}
                  step="0.01"
                  value={amounts[q.id] ?? ''}
                  onChange={(e) => setAmounts({ ...amounts, [q.id]: e.target.value })}
                  disabled={isAwarded}
                />
                {!isAwarded && (
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={saveQuote.isPending}
                    onClick={() => saveQuote.mutate({ id: q.id, totalAmount: parseFloat(amounts[q.id] || '0') })}
                  >
                    Save
                  </Button>
                )}
              </div>
              {q.totalAmount > 0 && (
                <p className="text-xs text-gray-500">Saved: {formatCurrency(Number(q.totalAmount))}</p>
              )}
              {!isAwarded && q.status !== 'APPROVED' && (
                <Button
                  size="sm"
                  loading={award.isPending}
                  onClick={() => award.mutate(q.id)}
                  disabled={!amounts[q.id] && !q.totalAmount}
                >
                  Award & Create PO
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="flex justify-end pt-4 border-t">
        <Button variant="secondary" onClick={onClose}>Close</Button>
      </div>
    </div>
  );
}
