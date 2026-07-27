import clsx from 'clsx';
import { ApexCoreLogo } from './ApexCoreLogo';
import { resolveUploadUrl } from '../../utils/uploads';
import { isPlatformCompanySlug } from '../../constants/platform';

interface CompanyBrandProps {
  name?: string;
  logo?: string | null;
  companySlug?: string | null;
  collapsed?: boolean;
  inverted?: boolean;
  className?: string;
  showPlatformFallback?: boolean;
  /** Force ApexCore branding (platform owner workspace). Ignores uploaded company logo. */
  platformBrand?: boolean;
}

const LOGO_FRAME = 'h-10 w-10 rounded-lg bg-white ring-1 ring-slate-200 shrink-0 overflow-hidden flex items-center justify-center p-0.5';
const LOGO_FRAME_COLLAPSED = 'h-9 w-9 rounded-lg bg-white ring-1 ring-slate-200 overflow-hidden flex items-center justify-center p-0.5';

function StandardLogoImage({
  src,
  alt,
  className,
  frameClassName,
}: {
  src: string;
  alt: string;
  className?: string;
  frameClassName: string;
}) {
  return (
    <div className={clsx(frameClassName, className)}>
      <img src={src} alt={alt} className="h-full w-full object-contain" />
    </div>
  );
}

export function CompanyBrand({
  name,
  logo,
  companySlug,
  collapsed = false,
  inverted = false,
  className,
  showPlatformFallback = true,
  platformBrand = false,
}: CompanyBrandProps) {
  const usePlatformBrand = platformBrand || isPlatformCompanySlug(companySlug);

  if (usePlatformBrand) {
    return collapsed ? (
      <ApexCoreLogo variant="mark" size="sm" inverted={inverted} className={className} />
    ) : (
      <ApexCoreLogo variant="sidebar" inverted={inverted} className={className} />
    );
  }

  const logoUrl = resolveUploadUrl(logo);
  const displayName = name?.trim();

  if (!displayName && !logoUrl && showPlatformFallback) {
    return collapsed ? (
      <ApexCoreLogo variant="mark" size="sm" inverted={inverted} className={className} />
    ) : (
      <ApexCoreLogo variant="sidebar" inverted={inverted} className={className} />
    );
  }

  if (collapsed) {
    return logoUrl ? (
      <StandardLogoImage
        src={logoUrl}
        alt={displayName || 'Company logo'}
        frameClassName={LOGO_FRAME_COLLAPSED}
        className={className}
      />
    ) : (
      <div
        className={clsx(
          LOGO_FRAME_COLLAPSED,
          'text-xs font-bold',
          inverted ? 'bg-white/15 text-white ring-white/20' : 'bg-primary-100 text-primary-700',
          className
        )}
      >
        {(displayName || 'C').charAt(0).toUpperCase()}
      </div>
    );
  }

  return (
    <div className={clsx('flex items-center gap-2 min-w-0', className)}>
      {logoUrl ? (
        <StandardLogoImage src={logoUrl} alt={displayName || 'Company logo'} frameClassName={LOGO_FRAME} />
      ) : (
        <div className={clsx(LOGO_FRAME, 'bg-primary-100 text-primary-700 text-xs font-bold')}>
          {(displayName || 'C').charAt(0).toUpperCase()}
        </div>
      )}
      <p
        className={clsx(
          'font-semibold text-[10px] leading-tight line-clamp-2 flex-1 min-w-0',
          inverted ? 'text-white' : 'text-slate-900'
        )}
        title={displayName || 'Workspace'}
      >
        {displayName || 'Workspace'}
      </p>
    </div>
  );
}

export function CompanyLogoMark({
  logo,
  name,
  companySlug,
  size = 'md',
  className,
  platformBrand = false,
}: {
  logo?: string | null;
  name?: string;
  companySlug?: string | null;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  platformBrand?: boolean;
}) {
  const usePlatformBrand = platformBrand || isPlatformCompanySlug(companySlug);

  if (usePlatformBrand) {
    const markSize = size === 'lg' ? 'lg' : size === 'sm' ? 'sm' : 'md';
    return <ApexCoreLogo variant="mark" size={markSize} className={className} />;
  }

  const logoUrl = resolveUploadUrl(logo);
  const frameSize =
    size === 'lg' ? 'h-16 w-16 rounded-xl p-2' : size === 'sm' ? 'h-8 w-8 rounded-lg p-0.5' : 'h-12 w-12 rounded-xl p-1';

  if (logoUrl) {
    return (
      <div className={clsx(frameSize, 'bg-white ring-1 ring-slate-200 overflow-hidden flex items-center justify-center', className)}>
        <img src={logoUrl} alt={name || 'Company logo'} className="h-full w-full object-contain" />
      </div>
    );
  }

  return (
    <div className={clsx(frameSize, 'bg-primary-100 text-primary-700 font-bold flex items-center justify-center', className)}>
      {(name || 'C').charAt(0).toUpperCase()}
    </div>
  );
}
