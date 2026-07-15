import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { crmApi } from '../../services/api';
import { Button } from '../ui';

const resolveSchema = z.object({
  resolution: z.string().min(1, 'Resolution notes are required'),
});

type ResolveFormData = z.infer<typeof resolveSchema>;

interface ComplaintResolveFormProps {
  complaintId: string;
  subject: string;
  onSuccess: () => void;
  onCancel: () => void;
}

export function ComplaintResolveForm({ complaintId, subject, onSuccess, onCancel }: ComplaintResolveFormProps) {
  const queryClient = useQueryClient();

  const { register, handleSubmit, formState: { errors } } = useForm<ResolveFormData>({
    resolver: zodResolver(resolveSchema),
    defaultValues: { resolution: '' },
  });

  const mutation = useMutation({
    mutationFn: (data: ResolveFormData) =>
      crmApi.resolveComplaint(complaintId, { resolution: data.resolution, status: 'APPROVED' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['complaints'] });
      queryClient.invalidateQueries({ queryKey: ['crm-stats'] });
      onSuccess();
    },
  });

  return (
    <form onSubmit={handleSubmit((data) => mutation.mutate(data))} className="space-y-4">
      <p className="text-sm text-gray-600">
        Resolving complaint: <span className="font-medium text-gray-900">{subject}</span>
      </p>

      {mutation.isError && (
        <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">
          Failed to resolve complaint. Please try again.
        </div>
      )}

      <div className="space-y-1">
        <label className="block text-sm font-medium text-gray-700">Resolution Notes *</label>
        <textarea
          className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          rows={4}
          placeholder="Describe how the complaint was resolved..."
          {...register('resolution')}
        />
        {errors.resolution?.message && (
          <p className="text-sm text-red-600">{errors.resolution.message}</p>
        )}
      </div>

      <div className="flex justify-end gap-3 pt-4 border-t">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" loading={mutation.isPending}>Mark Resolved</Button>
      </div>
    </form>
  );
}
