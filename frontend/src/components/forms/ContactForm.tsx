import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { customersApi } from '../../services/api';
import { Button, Input } from '../ui';

const contactSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  title: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional(),
  isPrimary: z.boolean().optional(),
});

type ContactFormData = z.infer<typeof contactSchema>;

interface ContactFormProps {
  customerId: string;
  onSuccess: () => void;
  onCancel: () => void;
}

export function ContactForm({ customerId, onSuccess, onCancel }: ContactFormProps) {
  const queryClient = useQueryClient();

  const { register, handleSubmit, formState: { errors } } = useForm<ContactFormData>({
    resolver: zodResolver(contactSchema),
    defaultValues: { name: '', title: '', email: '', phone: '', isPrimary: false },
  });

  const mutation = useMutation({
    mutationFn: (data: ContactFormData) =>
      customersApi.addContact(customerId, {
        ...data,
        email: data.email || undefined,
        title: data.title || undefined,
        phone: data.phone || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customer-detail', customerId] });
      onSuccess();
    },
  });

  return (
    <form onSubmit={handleSubmit((data) => mutation.mutate(data))} className="space-y-4">
      {mutation.isError && (
        <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">Failed to add contact.</div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Input label="Name *" {...register('name')} error={errors.name?.message} />
        <Input label="Title" {...register('title')} />
        <Input label="Email" type="email" {...register('email')} />
        <Input label="Phone" {...register('phone')} />
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" className="rounded border-border" {...register('isPrimary')} />
        Primary contact
      </label>

      <div className="flex justify-end gap-3 pt-4 border-t">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" loading={mutation.isPending}>Add Contact</Button>
      </div>
    </form>
  );
}
