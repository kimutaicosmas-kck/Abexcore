import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import { customersApi, operationsApi } from '../../services/api';
import { Input, Select, FormActions, ModalFormBody } from '../ui';
import { Customer } from '../../types';
import { useAuth } from '../../contexts/AuthContext';

const customerSchema = z
  .object({
    code: z.string().min(1, 'Code is required'),
    name: z.string().min(1, 'Name is required'),
    type: z.enum(['DEALER', 'RETAIL_SHOP', 'INDUSTRY', 'GOVERNMENT', 'NGO']),
    vatStatus: z.enum(['VAT', 'NON_VAT'], { required_error: 'VAT status is required' }),
    email: z.string().email().optional().or(z.literal('')),
    phone: z.string().optional(),
    address: z.string().optional(),
    city: z.string().optional(),
    taxPin: z.string().optional(),
    creditLimit: z.coerce.number().min(0).optional(),
    paymentTerms: z.coerce.number().int().min(0).optional(),
    salesPersonId: z.string().optional(),
    notes: z.string().optional(),
    isActive: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.vatStatus === 'VAT' && !data.taxPin?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Tax PIN is required for VAT customers',
        path: ['taxPin'],
      });
    }
  });

type CustomerFormData = z.infer<typeof customerSchema>;

const customerTypes = [
  { value: 'DEALER', label: 'Dealer' },
  { value: 'RETAIL_SHOP', label: 'Retail Shop' },
  { value: 'INDUSTRY', label: 'Industry' },
  { value: 'GOVERNMENT', label: 'Government' },
  { value: 'NGO', label: 'NGO' },
];

const vatStatusOptions = [
  { value: 'VAT', label: 'VAT registered' },
  { value: 'NON_VAT', label: 'Non-VAT' },
];

interface CustomerFormProps {
  customer?: Customer | null;
  onSuccess: () => void;
  onCancel: () => void;
}

function getApiError(error: unknown): string {
  const axiosError = error as AxiosError<{ message?: string }>;
  return axiosError.response?.data?.message || 'Failed to save customer. Please try again.';
}

export function CustomerForm({ customer, onSuccess, onCancel }: CustomerFormProps) {
  const queryClient = useQueryClient();
  const { isSalesOfficer } = useAuth();
  const isEdit = !!customer;
  const canAssignSalesPerson = !isSalesOfficer;

  const { data: salesOfficers } = useQuery({
    queryKey: ['sales-officers'],
    queryFn: () =>
      operationsApi.salesOfficers().then(
        (r) => r.data.data as { id: string; name: string; email: string }[]
      ),
    enabled: canAssignSalesPerson,
  });

  const { register, handleSubmit, watch, formState: { errors } } = useForm<CustomerFormData>({
    resolver: zodResolver(customerSchema),
    defaultValues: customer
      ? {
          code: customer.code,
          name: customer.name,
          type: customer.type as CustomerFormData['type'],
          vatStatus: customer.vatStatus || 'NON_VAT',
          email: customer.email || '',
          phone: customer.phone || '',
          address: customer.address || '',
          city: customer.city || '',
          taxPin: customer.taxPin || '',
          creditLimit: Number(customer.creditLimit),
          paymentTerms: customer.paymentTerms ?? 30,
          salesPersonId: customer.salesPersonId || '',
          notes: customer.notes || '',
          isActive: customer.isActive,
        }
      : {
          type: 'DEALER',
          vatStatus: 'NON_VAT',
          creditLimit: 0,
          paymentTerms: 30,
          salesPersonId: '',
          isActive: true,
        },
  });

  const vatStatus = watch('vatStatus');

  const mutation = useMutation({
    mutationFn: (data: CustomerFormData) => {
      const payload = {
        ...data,
        email: data.email || undefined,
        address: data.address || undefined,
        notes: data.notes || undefined,
        taxPin: data.taxPin || undefined,
        salesPersonId: data.salesPersonId || null,
      };
      return isEdit
        ? customersApi.update(customer!.id, payload)
        : customersApi.create(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: ['crm-stats'] });
      if (isEdit) queryClient.invalidateQueries({ queryKey: ['customer-detail', customer!.id] });
      onSuccess();
    },
  });

  const salesPersonOptions = [
    { value: '', label: 'No sales person (unassigned)' },
    ...(salesOfficers || []).map((o) => ({ value: o.id, label: o.name })),
  ];

  return (
    <form onSubmit={handleSubmit((data) => mutation.mutate(data))}>
      <ModalFormBody
        footer={
          <FormActions
            onCancel={onCancel}
            submitLabel={isEdit ? 'Update Customer' : 'Create Customer'}
            loading={mutation.isPending}
          />
        }
      >
      {mutation.isError && (
        <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">{getApiError(mutation.error)}</div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Input label="Customer Code *" {...register('code')} error={errors.code?.message} disabled={isEdit} />
        <Input label="Name *" {...register('name')} error={errors.name?.message} />
        <Select label="Type" options={customerTypes} {...register('type')} error={errors.type?.message} />
        <Select
          label="VAT status *"
          options={vatStatusOptions}
          {...register('vatStatus')}
          error={errors.vatStatus?.message}
        />
        {canAssignSalesPerson && (
          <Select
            label="Sales Person"
            options={salesPersonOptions}
            {...register('salesPersonId')}
          />
        )}
        <Input label="Email" type="email" {...register('email')} error={errors.email?.message} />
        <Input label="Phone" {...register('phone')} />
        <Input label="City" {...register('city')} />
        <Input
          label={vatStatus === 'VAT' ? 'Tax PIN *' : 'Tax PIN'}
          {...register('taxPin')}
          error={errors.taxPin?.message}
          placeholder={vatStatus === 'VAT' ? 'Required for VAT customers' : 'Optional'}
        />
        <div>
          <Input label="Credit Limit (KES) — optional" type="number" min={0} step="0.01" {...register('creditLimit')} />
          <p className="text-xs text-slate-500 mt-1">
            Maximum unpaid balance allowed for this customer. Set to 0 for no credit limit check.
          </p>
        </div>
        <Input label="Payment Terms (days)" type="number" {...register('paymentTerms')} />
        {isEdit && (
          <Select
            label="Status"
            options={[
              { value: 'true', label: 'Active' },
              { value: 'false', label: 'Inactive' },
            ]}
            {...register('isActive', {
              setValueAs: (v) => v === true || v === 'true',
            })}
          />
        )}
      </div>
      <p className="text-xs text-slate-500 -mt-1">
        {vatStatus === 'NON_VAT'
          ? 'Non-VAT: the company still creates sales invoices for this customer, charged at 0% VAT.'
          : 'VAT: invoices include company VAT. Tax PIN is required.'}
      </p>
      {canAssignSalesPerson && (
        <p className="-mt-2 text-xs text-slate-500">
          Assign a sales officer to own this account, or leave blank so any sales user with rights
          can see them and place orders.
        </p>
      )}
      <Input label="Address" {...register('address')} />
      <Input label="Notes" {...register('notes')} />
      </ModalFormBody>
    </form>
  );
}
