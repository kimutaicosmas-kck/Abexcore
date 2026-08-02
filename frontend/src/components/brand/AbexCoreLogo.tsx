import clsx from 'clsx';
import { BRAND_WORDMARK } from '../../constants/brand';

interface LogoMarkProps {
  className?: string;
  inverted?: boolean;
}

function LogoMark({ className, inverted }: LogoMarkProps) {
  const stroke = inverted ? '#ffffff' : '#111827';
  const fill = inverted ? '#ffffff' : '#111827';
  const innerDot = inverted ? '#111827' : '#ffffff';

  return (
    <svg
      viewBox="0 0 32 32"
      className={clsx('shrink-0', className)}
      fill="none"
      aria-hidden
    >
      <path
        d="M16 4.5L26.5 10.5V21.5L16 27.5L5.5 21.5V10.5L16 4.5Z"
        stroke={stroke}
        strokeWidth="1.75"
      />
      <path d="M16 10.5L21.25 16L16 21.5L10.75 16L16 10.5Z" fill={fill} />
      <circle cx="16" cy="16" r="1.75" fill={innerDot} />
      <circle cx="16" cy="16" r="0.75" fill={fill} />
    </svg>
  );
}

interface AbexCoreLogoProps {
  variant?: 'full' | 'mark' | 'sidebar';
  className?: string;
  inverted?: boolean;
  centered?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

const markSizes = {
  sm: 'h-8 w-8',
  md: 'h-12 w-12',
  lg: 'h-16 w-16',
};

const wordmarkSizes = {
  sm: 'text-xs',
  md: 'text-sm',
  lg: 'text-xl',
};

export function AbexCoreLogo({
  variant = 'full',
  className,
  inverted = false,
  centered = true,
  size = 'md',
}: AbexCoreLogoProps) {
  if (variant === 'mark') {
    return <LogoMark inverted={inverted} className={clsx(markSizes[size], className)} />;
  }

  if (variant === 'sidebar') {
    return (
      <div className={clsx('flex items-center gap-2.5 min-w-0', className)}>
        <LogoMark inverted={inverted} className="h-8 w-8" />
        <p className={clsx('font-bold text-sm tracking-wide truncate', inverted ? 'text-white' : 'text-slate-900')}>
          {BRAND_WORDMARK}
        </p>
      </div>
    );
  }

  return (
    <div
      className={clsx(
        'flex flex-col gap-2',
        centered ? 'items-center text-center' : 'items-start text-left',
        className
      )}
    >
      <div
        className={clsx(
          'rounded-2xl p-3',
          inverted ? 'bg-white/10 ring-1 ring-white/20' : 'bg-white ring-1 ring-slate-200 shadow-soft'
        )}
      >
        <LogoMark inverted={inverted} className={markSizes[size === 'md' ? 'lg' : size]} />
      </div>
      <p
        className={clsx(
          'font-bold tracking-[0.2em] uppercase',
          wordmarkSizes[size],
          inverted ? 'text-white' : 'text-slate-900'
        )}
      >
        {BRAND_WORDMARK}
      </p>
    </div>
  );
}

/** @deprecated Use AbexCoreLogo — kept for temporary import compatibility. */
export const ApexCoreLogo = AbexCoreLogo;

export { LogoMark };
