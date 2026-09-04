import { useState } from 'react';
import { ConfirmDialog } from '../ui';

interface FormDraftNoticeProps {
  draftSavedAt: Date | null;
  draftRestored?: boolean;
  /** Show notice even before first autosave (e.g. opened saved document draft). */
  show?: boolean;
  onDiscard?: () => void | Promise<void>;
  discarding?: boolean;
}

export function FormDraftNotice({
  draftSavedAt,
  draftRestored,
  show,
  onDiscard,
  discarding,
}: FormDraftNoticeProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (!show && !draftSavedAt && !draftRestored) return null;

  const handleDiscard = async () => {
    if (!onDiscard) return;
    await onDiscard();
    setConfirmOpen(false);
  };

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
        <p className="min-w-0 flex-1">
          {draftRestored && !draftSavedAt
            ? 'Draft restored — continue where you left off.'
            : 'Draft saved — you can leave this page and continue later.'}
        </p>
        {onDiscard && (
          <button
            type="button"
            disabled={discarding}
            onClick={() => setConfirmOpen(true)}
            className="shrink-0 text-xs font-medium text-red-700 underline-offset-2 hover:underline disabled:opacity-50"
          >
            {discarding ? 'Discarding…' : 'Discard draft'}
          </button>
        )}
      </div>
      <ConfirmDialog
        open={confirmOpen}
        title="Discard draft?"
        message="This will permanently delete the saved draft. You cannot undo this action."
        confirmLabel="Discard draft"
        loading={discarding}
        onConfirm={() => void handleDiscard()}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}
