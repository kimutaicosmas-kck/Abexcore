import clsx from 'clsx';
import { APP_VERSION, POWERED_BY } from '../../constants/brand';

interface PoweredByProps {
  className?: string;
  centered?: boolean;
  showVersion?: boolean;
}

export function PoweredBy({ className, centered = true, showVersion = true }: PoweredByProps) {
  return (
    <p className={clsx('text-[10px] sm:text-xs text-slate-500', centered && 'text-center', className)}>
      {POWERED_BY}
      {showVersion && ` · v${APP_VERSION}`}
    </p>
  );
}