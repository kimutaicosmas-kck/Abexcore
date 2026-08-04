import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Calendar, CalendarPlus } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { hrApi } from '../services/api';
import {
  PageHeader,
  Table,
  Badge,
  Button,
  Input,
  Select,
  EmptyState,
  DataPanel,
  TablePagination,
  formatDate,
  getStatusBadge,
  QueryErrorAlert,
} from '../components/ui';
import { Modal } from '../components/ui/Modal';
import { LeaveBalancesPayload, LeaveRequest } from '../types';
import { getApiErrorMessage } from '../utils/apiError';

const myLeaveSchema = z.object({
  type: z.string().min(1, 'Leave type is required'),
  startDate: z.string().min(1, 'Start date is required'),
  endDate: z.string().min(1, 'End date is required'),
  reason: z.string().optional(),
});

type MyLeaveFormData = z.infer<typeof myLeaveSchema>;

const leaveTypeOptions = [
  { value: '', label: 'Select type...' },
  { value: 'ANNUAL', label: 'Annual Leave' },
  { value: 'SICK', label: 'Sick Leave' },
  { value: 'COMPASSIONATE', label: 'Compassionate Leave' },
  { value: 'MATERNITY', label: 'Maternity Leave' },
  { value: 'PATERNITY', label: 'Paternity Leave' },
  { value: 'UNPAID', label: 'Unpaid Leave' },
];

function leaveLabel(type: string) {
  return type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function MyLeavePage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const year = new Date().getFullYear();

  const { data: balancesRes, isLoading: balancesLoading } = useQuery({
    queryKey: ['my-leave-balances', year],
    queryFn: () =>
      hrApi.myLeaveBalances({ year }).then((r) => r.data.data as LeaveBalancesPayload),
  });

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['my-leave', page],
    queryFn: () => hrApi.myLeave({ page, limit: 15 }).then((r) => r.data),
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<MyLeaveFormData>({
    resolver: zodResolver(myLeaveSchema),
    defaultValues: { type: '', reason: '' },
  });

  const mutation = useMutation({
    mutationFn: (form: MyLeaveFormData) =>
      hrApi.requestMyLeave({ ...form, reason: form.reason || undefined }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-leave'] });
      queryClient.invalidateQueries({ queryKey: ['my-leave-balances'] });
      reset();
      setOpen(false);
    },
  });

  const columns = [
    {
      key: 'type',
      label: 'Type',
      render: (val: unknown) => leaveLabel(String(val)),
    },
    {
      key: 'startDate',
      label: 'From',
      render: (val: unknown) => formatDate(val as string),
    },
    {
      key: 'endDate',
      label: 'To',
      render: (val: unknown) => formatDate(val as string),
    },
    {
      key: 'reason',
      label: 'Reason',
      render: (val: unknown) => (val as string) || '—',
    },
    {
      key: 'status',
      label: 'Status',
      render: (val: unknown) => <Badge variant={getStatusBadge(val as string)}>{val as string}</Badge>,
    },
    {
      key: 'approvedBy',
      label: 'Decided by',
      render: (_: unknown, row: Record<string, unknown>) => {
        const leave = row as unknown as LeaveRequest;
        if (!leave.approvedBy) return '—';
        return `${leave.approvedBy.firstName} ${leave.approvedBy.lastName}`;
      },
    },
  ];

  const balances = balancesRes?.balances || [];

  return (
    <div className="space-y-4">
      <PageHeader
        subtitle={`Your ${year} leave balances reset each January. Request leave below — HR will review it.`}
      />

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {(balancesLoading
          ? ['ANNUAL', 'SICK', 'COMPASSIONATE', 'PATERNITY', 'MATERNITY']
          : balances.map((b) => b.type)
        ).map((typeOrKey, idx) => {
          const row = balances.find((b) => b.type === typeOrKey);
          return (
            <div
              key={String(typeOrKey) + idx}
              className="rounded-2xl border border-primary-100 bg-white px-3 py-3 shadow-sm"
            >
              <div className="flex items-center gap-2 text-primary-700/80 mb-1.5">
                <Calendar className="h-3.5 w-3.5" />
                <p className="text-[11px] font-semibold uppercase tracking-wide">
                  {leaveLabel(String(typeOrKey))}
                </p>
              </div>
              <p className="text-xl font-bold text-primary-950 tabular-nums">
                {balancesLoading ? '…' : `${row?.remainingDays ?? 0}`}
                <span className="text-xs font-medium text-slate-500 ml-1">days left</span>
              </p>
              <p className="text-xs text-slate-500 mt-0.5">
                {balancesLoading ? 'Loading…' : `${row?.usedDays ?? 0} used · ${row?.entitledDays ?? 0} entitled`}
              </p>
            </div>
          );
        })}
      </div>

      <div className="flex justify-end">
        <Button size="sm" onClick={() => setOpen(true)}>
          <CalendarPlus className="mr-1.5 h-4 w-4" />
          Request leave
        </Button>
      </div>

      {isError && <QueryErrorAlert error={error} onRetry={() => refetch()} />}

      <DataPanel>
        {(data?.data?.length || 0) === 0 && !isLoading ? (
          <EmptyState
            title="No leave requests yet"
            description="Request annual, sick, or other leave — HR will review it."
            action={
              <Button onClick={() => setOpen(true)}>
                <CalendarPlus className="mr-1.5 h-4 w-4" />
                Request leave
              </Button>
            }
          />
        ) : (
          <Table
            columns={columns}
            data={(data?.data as LeaveRequest[]) || []}
            loading={isLoading}
            embedded
          />
        )}
        <TablePagination
          pagination={data?.pagination}
          page={page}
          onPageChange={setPage}
          label="requests"
        />
      </DataPanel>

      <Modal
        open={open}
        onClose={() => {
          setOpen(false);
          mutation.reset();
        }}
        title="Request leave"
        size="lg"
      >
        <form
          onSubmit={handleSubmit((form) => mutation.mutate(form))}
          className="space-y-4"
        >
          {mutation.isError && (
            <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
              {getApiErrorMessage(mutation.error)}
            </div>
          )}
          <Select
            label="Leave Type *"
            options={leaveTypeOptions}
            {...register('type')}
            error={errors.type?.message}
          />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Input
              label="Start Date *"
              type="date"
              {...register('startDate')}
              error={errors.startDate?.message}
            />
            <Input
              label="End Date *"
              type="date"
              {...register('endDate')}
              error={errors.endDate?.message}
            />
          </div>
          <Input label="Reason" {...register('reason')} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={mutation.isPending}>
              Submit request
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
