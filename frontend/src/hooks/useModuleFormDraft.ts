import { useCallback, useEffect, useRef, useState } from 'react';
import type { DefaultValues, FieldValues, UseFormGetValues, UseFormReset, UseFormWatch } from 'react-hook-form';
import { draftsApi } from '../services/api';

export type ModuleDraftEnvelope<T extends FieldValues> = {
  form: T;
  ui?: Record<string, unknown>;
};

interface UseModuleFormDraftOptions<T extends FieldValues> {
  moduleKey: string;
  watch: UseFormWatch<T>;
  getValues: UseFormGetValues<T>;
  reset: UseFormReset<T>;
  defaultValues: DefaultValues<T>;
  isMeaningful: (values: T) => boolean;
  enabled?: boolean;
  debounceMs?: number;
  /** Extra UI-only state (e.g. customer search text) stored alongside form values. */
  getUiState?: () => Record<string, unknown> | undefined;
  onRestoreUi?: (ui: Record<string, unknown> | undefined) => void;
}

export function useModuleFormDraft<T extends FieldValues>({
  moduleKey,
  watch,
  getValues,
  reset,
  defaultValues,
  isMeaningful,
  enabled = true,
  debounceMs = 2000,
  getUiState,
  onRestoreUi,
}: UseModuleFormDraftOptions<T>) {
  const [draftRestored, setDraftRestored] = useState(false);
  const [draftSavedAt, setDraftSavedAt] = useState<Date | null>(null);
  const savingRef = useRef(false);
  const lastSavedRef = useRef('');
  const hydratedRef = useRef(false);

  useEffect(() => {
    if (!enabled || hydratedRef.current) return;
    hydratedRef.current = true;

    void (async () => {
      try {
        const response = await draftsApi.get(moduleKey);
        const payload = response.data.data?.payload as ModuleDraftEnvelope<T> | T | undefined;
        if (!payload) return;

        const envelope =
          payload && typeof payload === 'object' && 'form' in payload
            ? (payload as ModuleDraftEnvelope<T>)
            : { form: payload as T };

        if (!envelope.form || typeof envelope.form !== 'object') return;
        reset({ ...defaultValues, ...envelope.form });
        onRestoreUi?.(envelope.ui);
        setDraftRestored(true);
      } catch {
        // No draft yet — normal for new forms.
      }
    })();
  }, [defaultValues, enabled, moduleKey, onRestoreUi, reset]);

  const persist = useCallback(
    async (force = false) => {
      if (!enabled) return;
      const form = getValues();
      if (!isMeaningful(form)) return;

      const envelope: ModuleDraftEnvelope<T> = {
        form,
        ui: getUiState?.(),
      };
      const serialized = JSON.stringify(envelope);
      if (!force && serialized === lastSavedRef.current) return;
      if (savingRef.current) return;

      savingRef.current = true;
      try {
        await draftsApi.save(moduleKey, envelope);
        lastSavedRef.current = serialized;
        setDraftSavedAt(new Date());
      } catch {
        // Autosave should not interrupt the user.
      } finally {
        savingRef.current = false;
      }
    },
    [enabled, getUiState, getValues, isMeaningful, moduleKey]
  );

  useEffect(() => {
    if (!enabled) return;
    let timer: number | undefined;
    const sub = watch(() => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void persist();
      }, debounceMs);
    });
    return () => {
      sub.unsubscribe();
      if (timer) window.clearTimeout(timer);
    };
  }, [watch, persist, debounceMs, enabled]);

  useEffect(() => {
    return () => {
      if (enabled) void persist(true);
    };
  }, [enabled, persist]);

  const clearDraft = useCallback(async () => {
    lastSavedRef.current = '';
    setDraftSavedAt(null);
    setDraftRestored(false);
    try {
      await draftsApi.remove(moduleKey);
    } catch {
      // Ignore cleanup failures.
    }
  }, [moduleKey]);

  return { draftRestored, draftSavedAt, clearDraft, flushDraft: () => persist(true) };
}

/** Standard module keys for form draft persistence. */
export const FORM_DRAFT_MODULES = {
  salesOrder: 'sales_order',
  requisition: 'requisition',
  rfq: 'rfq',
  purchaseOrder: 'purchase_order',
  delivery: 'delivery',
  opportunity: 'opportunity',
  journalEntry: 'journal_entry',
  goodsReceipt: 'goods_receipt',
  productionOrder: 'production_order',
  payment: 'payment',
  complaint: 'complaint',
  leave: 'leave',
  maintenance: 'maintenance',
  contact: 'contact',
  customer: 'customer',
  supplier: 'supplier',
  salaryAdvance: 'salary_advance',
  attendance: 'attendance',
  machine: 'machine',
  vehicle: 'vehicle',
  rawMaterial: 'raw_material',
  product: 'product',
  warranty: 'warranty',
  quality: 'quality',
  stockTransfer: 'stock_transfer',
  stockAdjust: 'stock_adjust',
  employee: 'employee',
  payroll: 'payroll',
} as const;
