import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { inventoryApi } from '../../services/api';
import { Button, Input } from '../ui';
import { Supplier } from '../../types';

const supplierSchema = z.object({
  code: z.string().min(1, 'Code is required'),
  name: z.string().min(1, 'Name is required'),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  taxPin: z.string().optional(),
  paymentTerms: z.coerce.number().int().min(0).optional(),
  leadTimeDays: z.coerce.number().int().min(0).optional(),
  notes: z.string().optional(),
});

type SupplierFormData = z.infer<typeof supplierSchema>;

interface SupplierFormProps {
  supplier?: Supplier | null;
  onSuccess: () => void;
  onCancel: () => void;
}

export function SupplierForm({ supplier, onSuccess, onCancel }: SupplierFormProps) {
  const queryClient = useQueryClient();
  const isEdit = !!supplier;

  const { register, handleSubmit, formState: { errors } } = useForm<SupplierFormData>({
    resolver: zodResolver(supplierSchema),
    defaultValues: supplier
      ? {
          code: supplier.code,
          name: supplier.name,
          email: supplier.email || '',
          phone: supplier.phone || '',
          city: supplier.city || '',
          leadTimeDays: supplier.leadTimeDays,
          paymentTerms: 30,
        }
      : { paymentTerms: 30, leadTimeDays: 7 },
  });

  const mutation = useMutation({
    mutationFn: (data: SupplierFormData) => {
      const payload = { ...data, email: data.email || undefined };
      return isEdit
        ? inventoryApi.updateSupplier(supplier!.id, payload)
        : inventoryApi.createSupplier(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      queryClient.invalidateQueries({ queryKey: ['procurement-stats'] });
      onSuccess();
    },
  });

  return (
    <form onSubmit={handleSubmit((data) => mutation.mutate(data))} className="space-y-4">
      {mutation.isError && (
        <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">
          Failed to save supplier. Please try again.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Input label="Supplier Code *" {...register('code')} error={errors.code?.message} disabled={isEdit} />
        <Input label="Name *" {...register('name')} error={errors.name?.message} />
        <Input label="Email" type="email" {...register('email')} error={errors.email?.message} />
        <Input label="Phone" {...register('phone')} />
        <Input label="City" {...register('city')} />
        <Input label="Tax PIN" {...register('taxPin')} />
        <Input label="Payment Terms (days)" type="number" {...register('paymentTerms')} />
        <Input label="Lead Time (days)" type="number" {...register('leadTimeDays')} />
      </div>
      <Input label="Address" {...register('address')} />
      <Input label="Notes" {...register('notes')} />

      <div className="flex justify-end gap-3 pt-4 border-t">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" loading={mutation.isPending}>
          {isEdit ? 'Update Supplier' : 'Create Supplier'}
        </Button>
      </div>
    </form>
  );
}
