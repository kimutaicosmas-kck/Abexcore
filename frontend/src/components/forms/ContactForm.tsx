import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { customersApi } from '../../services/api';
import { Button, Input } from '../ui';
import { FORM_DRAFT_MODULES, useModuleFormDraft } from '../../hooks/useModuleFormDraft';
import { FormDraftNotice } from './FormDraftNotice';

const contactSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  title: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional(),
  isPrimary: z.boolean().optional(),
});

type ContactFormData = z.infer<typeof contactSchema>;

const contactDefaultValues: ContactFormData = {
  name: '',
  title: '',
  email: '',
  phone: '',
  isPrimary: false,
};

interface ContactFormProps {
  customerId: string;
  onSuccess: () => void;
  onCancel: () => void;
}

export function ContactForm({ customerId, onSuccess, onCancel }: ContactFormProps) {
  const queryClient = useQueryClient();

  const { register, handleSubmit, watch, getValues, reset, formState: { errors } } = useForm<ContactFormData>({
    resolver: zodResolver(contactSchema),
    defaultValues: contactDefaultValues,
  });

  const { draftSavedAt, draftRestored, clearDraft, discardDraft } = useModuleFormDraft({
    moduleKey: FORM_DRAFT_MODULES.contact,
    watch,
    getValues,
    reset,
    defaultValues: contactDefaultValues,
    isMeaningful: (data) =>
      Boolean(data.name?.trim()) ||
      Boolean(data.title?.trim()) ||
      Boolean(data.email?.trim()) ||
      Boolean(data.phone?.trim()) ||
      Boolean(data.isPrimary),
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
      void clearDraft();
      queryClient.invalidateQueries({ queryKey: ['customer-detail', customerId] });
      onSuccess();
    },
  });

  return (
    <form onSubmit={handleSubmit((data) => mutation.mutate(data))} className="space-y-4">
      <FormDraftNotice draftSavedAt={draftSavedAt} draftRestored={draftRestored} onDiscard={discardDraft} />
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
