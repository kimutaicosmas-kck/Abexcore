interface FormDraftNoticeProps {
  draftSavedAt: Date | null;
  draftRestored?: boolean;
}

export function FormDraftNotice({ draftSavedAt, draftRestored }: FormDraftNoticeProps) {
  if (!draftSavedAt && !draftRestored) return null;
  return (
    <div className="p-3 rounded-lg bg-emerald-50 text-emerald-800 text-sm">
      {draftRestored && !draftSavedAt
        ? 'Draft restored — continue where you left off.'
        : 'Draft saved — you can leave this page and continue later.'}
    </div>
  );
}
