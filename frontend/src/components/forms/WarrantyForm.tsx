import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { crmApi, customersApi, productsApi } from '../../services/api';
import { Button, Input, Select, Textarea } from '../ui';
import { Customer, Product } from '../../types';
import { formatProductOptionLabel } from '../../utils/productDisplay';

const warrantySchema = z.object({
  customerId: z.string().min(1, 'Customer is required'),
  productId: z.string().min(1, 'Product is required'),
  serialNumber: z.string().optional(),
  startDate: z.string().min(1, 'Start date is required'),
  endDate: z.string().min(1, 'End date is required'),
  notes: z.string().optional(),
});

type WarrantyFormData = z.infer<typeof warrantySchema>;

interface WarrantyFormProps {
  onSuccess: () => void;
  onCancel: () => void;
}

export function WarrantyForm({ onSuccess, onCancel }: WarrantyFormProps) {
  const queryClient = useQueryClient();

  const { data: customersData } = useQuery({
    queryKey: ['customers'],
    queryFn: () => customersApi.list({ limit: 100 }).then((r) => r.data.data as Customer[]),
  });

  const { data: productsData } = useQuery({
    queryKey: ['products'],
    queryFn: () => productsApi.list({ limit: 100 }).then((r) => r.data.data as Product[]),
  });

  const customerOptions = [
    { value: '', label: 'Select customer...' },
    ...(customersData || []).map((c) => ({ value: c.id, label: `${c.code} - ${c.name}` })),
  ];

  const productOptions = [
    { value: '', label: 'Select product...' },
    ...(productsData || []).map((p) => ({ value: p.id, label: formatProductOptionLabel(p) })),
  ];

  const { register, handleSubmit, formState: { errors } } = useForm<WarrantyFormData>({
    resolver: zodResolver(warrantySchema),
    defaultValues: {
      customerId: '',
      productId: '',
      startDate: new Date().toISOString().slice(0, 10),
      endDate: '',
      notes: '',
    },
  });

  const mutation = useMutation({
    mutationFn: (data: WarrantyFormData) =>
      crmApi.createWarranty({
        ...data,
        serialNumber: data.serialNumber || undefined,
        notes: data.notes || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['warranties'] });
      queryClient.invalidateQueries({ queryKey: ['crm-stats'] });
      onSuccess();
    },
  });

  return (
    <form onSubmit={handleSubmit((data) => mutation.mutate(data))} className="space-y-4">
      {mutation.isError && (
        <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">
          Failed to register warranty. Please try again.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Select label="Customer *" options={customerOptions} {...register('customerId')} error={errors.customerId?.message} />
        <Select label="Product *" options={productOptions} {...register('productId')} error={errors.productId?.message} />
        <Input label="Serial Number" {...register('serialNumber')} />
        <Input label="Start Date *" type="date" {...register('startDate')} error={errors.startDate?.message} />
        <Input label="End Date *" type="date" {...register('endDate')} error={errors.endDate?.message} />
      </div>
      <Textarea label="Notes" rows={3} {...register('notes')} />

      <div className="flex justify-end gap-3 pt-4 border-t">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" loading={mutation.isPending}>Register Warranty</Button>
      </div>
    </form>
  );
}
