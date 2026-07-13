import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { customersApi } from '../../services/api';
import { Button, Input, Select } from '../ui';
import { Customer } from '../../types';

const customerSchema = z.object({
  code: z.string().min(1, 'Code is required'),
  name: z.string().min(1, 'Name is required'),
  type: z.enum(['DEALER', 'RETAIL_SHOP', 'INDUSTRY', 'GOVERNMENT', 'NGO']),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  taxPin: z.string().optional(),
  creditLimit: z.coerce.number().min(0).optional(),
  paymentTerms: z.coerce.number().int().min(0).optional(),
  notes: z.string().optional(),
});

type CustomerFormData = z.infer<typeof customerSchema>;

const customerTypes = [
  { value: 'DEALER', label: 'Dealer' },
  { value: 'RETAIL_SHOP', label: 'Retail Shop' },
  { value: 'INDUSTRY', label: 'Industry' },
  { value: 'GOVERNMENT', label: 'Government' },
  { value: 'NGO', label: 'NGO' },
];

interface CustomerFormProps {
  customer?: Customer | null;
  onSuccess: () => void;
  onCancel: () => void;
}

export function CustomerForm({ customer, onSuccess, onCancel }: CustomerFormProps) {
  const queryClient = useQueryClient();
  const isEdit = !!customer;

  const { register, handleSubmit, formState: { errors } } = useForm<CustomerFormData>({
    resolver: zodResolver(customerSchema),
    defaultValues: customer
      ? {
          code: customer.code,
          name: customer.name,
          type: customer.type as CustomerFormData['type'],
          email: customer.email || '',
          phone: customer.phone || '',
          city: customer.city || '',
          creditLimit: Number(customer.creditLimit),
          paymentTerms: 30,
        }
      : {
          type: 'DEALER',
          creditLimit: 0,
          paymentTerms: 30,
        },
  });

  const mutation = useMutation({
    mutationFn: (data: CustomerFormData) => {
      const payload = { ...data, email: data.email || undefined };
      return isEdit
        ? customersApi.update(customer!.id, payload)
        : customersApi.create(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      onSuccess();
    },
  });

  return (
    <form onSubmit={handleSubmit((data) => mutation.mutate(data))} className="space-y-4">
      {mutation.isError && (
        <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">
          Failed to save customer. Please try again.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Input label="Customer Code *" {...register('code')} error={errors.code?.message} disabled={isEdit} />
        <Input label="Name *" {...register('name')} error={errors.name?.message} />
        <Select label="Type" options={customerTypes} {...register('type')} error={errors.type?.message} />
        <Input label="Email" type="email" {...register('email')} error={errors.email?.message} />
        <Input label="Phone" {...register('phone')} />
        <Input label="City" {...register('city')} />
        <Input label="Tax PIN" {...register('taxPin')} />
        <Input label="Credit Limit (KES)" type="number" {...register('creditLimit')} />
        <Input label="Payment Terms (days)" type="number" {...register('paymentTerms')} />
      </div>
      <Input label="Address" {...register('address')} />
      <Input label="Notes" {...register('notes')} />

      <div className="flex justify-end gap-3 pt-4 border-t">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" loading={mutation.isPending}>
          {isEdit ? 'Update Customer' : 'Create Customer'}
        </Button>
      </div>
    </form>
  );
}
