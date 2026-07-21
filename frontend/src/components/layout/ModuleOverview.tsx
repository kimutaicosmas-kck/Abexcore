import { ReactNode } from 'react';
import { Card, Button } from '../ui';

/** Standard thin overview — use instead of QuickActionGrid + duplicate tables. */
export function OverviewLayout({ children }: { children: ReactNode }) {
  return <div className="space-y-4">{children}</div>;
}

export function OverviewHint({ children }: { children: ReactNode }) {
  return <p className="text-sm text-slate-500">{children}</p>;
}

export function OverviewPreviewCard({
  title,
  viewAllLabel = 'View all',
  onViewAll,
  emptyTitle,
  emptyDescription,
  isEmpty,
  children,
}: {
  title: string;
  viewAllLabel?: string;
  onViewAll?: () => void;
  emptyTitle?: string;
  emptyDescription?: string;
  isEmpty?: boolean;
  children: ReactNode;
}) {
  return (
    <Card
      title={title}
      action={
        onViewAll ? (
          <Button variant="ghost" size="sm" onClick={onViewAll}>
            {viewAllLabel}
          </Button>
        ) : undefined
      }
      padding={false}
    >
      {isEmpty ? (
        <div className="p-6 text-center text-sm text-slate-500">
          <p className="font-medium text-slate-700">{emptyTitle}</p>
          {emptyDescription && <p className="text-xs mt-1">{emptyDescription}</p>}
        </div>
      ) : (
        children
      )}
    </Card>
  );
}
