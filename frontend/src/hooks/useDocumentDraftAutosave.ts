import { useCallback, useEffect, useRef } from 'react';
import type { FieldValues, UseFormGetValues, UseFormWatch } from 'react-hook-form';

type SaveDraftFn<T> = (payload: T, draftId?: string) => Promise<{ id: string }>;

interface UseDocumentDraftAutosaveOptions<T extends FieldValues> {
  watch: UseFormWatch<T>;
  getValues: UseFormGetValues<T>;
  draftId?: string;
  onDraftId: (id: string) => void;
  saveDraft: SaveDraftFn<T>;
  isMeaningful: (values: T) => boolean;
  enabled?: boolean;
  debounceMs?: number;
  storageKey: string;
}

export function useDocumentDraftAutosave<T extends FieldValues>({
  watch,
  getValues,
  draftId,
  onDraftId,
  saveDraft,
  isMeaningful,
  enabled = true,
  debounceMs = 2000,
  storageKey,
}: UseDocumentDraftAutosaveOptions<T>) {
  const draftIdRef = useRef(draftId);
  const savingRef = useRef(false);
  const lastSavedRef = useRef('');

  useEffect(() => {
    draftIdRef.current = draftId;
  }, [draftId]);

  const persist = useCallback(
    async (values: T, force = false) => {
      if (!enabled || !isMeaningful(values)) return;
      const serialized = JSON.stringify(values);
      if (!force && serialized === lastSavedRef.current) return;
      if (savingRef.current) return;

      savingRef.current = true;
      try {
        const result = await saveDraft(values, draftIdRef.current);
        lastSavedRef.current = serialized;
        if (result.id) {
          if (result.id !== draftIdRef.current) {
            onDraftId(result.id);
          }
          sessionStorage.setItem(storageKey, result.id);
        }
      } catch {
        // Autosave failures should not block the user.
      } finally {
        savingRef.current = false;
      }
    },
    [enabled, isMeaningful, onDraftId, saveDraft, storageKey]
  );

  useEffect(() => {
    if (!enabled) return;
    let timer: number | undefined;
    const sub = watch(() => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void persist(getValues());
      }, debounceMs);
    });
    return () => {
      sub.unsubscribe();
      if (timer) window.clearTimeout(timer);
    };
  }, [watch, getValues, persist, debounceMs, enabled]);

  useEffect(() => {
    return () => {
      const values = getValues();
      if (enabled && isMeaningful(values)) {
        void persist(values, true);
      }
    };
  }, [enabled, getValues, isMeaningful, persist]);

  const clearStoredDraft = useCallback(() => {
    sessionStorage.removeItem(storageKey);
    lastSavedRef.current = '';
  }, [storageKey]);

  return { flushDraft: () => persist(getValues(), true), clearStoredDraft };
}

export function readStoredDraftId(storageKey: string): string | undefined {
  const id = sessionStorage.getItem(storageKey);
  return id || undefined;
}
