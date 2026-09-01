import prisma from '../config/database';
import {
  ABEXCORE_PLATFORM_PALETTE,
  generateCompanyBrandPalette,
  normalizeBrandMode,
  type CompanyBrandMode,
} from './companyBrandPalette';
import { isPlatformCompanySlug } from './platform';

/** Persist a palette when a company has none yet (registration or legacy tenants). */
export async function ensureCompanyBrandColors(company: {
  id: string;
  slug: string;
  brandMode?: string | null;
  brandPrimary?: string | null;
  brandAccent?: string | null;
  docPrimaryColor?: string | null;
}): Promise<{
  brandMode: CompanyBrandMode;
  brandPrimary: string;
  brandAccent: string;
  docPrimaryColor: string;
}> {
  const mode: CompanyBrandMode = isPlatformCompanySlug(company.slug)
    ? 'abexcore'
    : normalizeBrandMode(company.brandMode);

  if (mode === 'abexcore' || isPlatformCompanySlug(company.slug)) {
    const platform = ABEXCORE_PLATFORM_PALETTE;
    const needsPersist =
      company.brandMode !== 'abexcore' ||
      company.brandPrimary?.toLowerCase() !== platform.brandPrimary ||
      company.brandAccent?.toLowerCase() !== platform.brandAccent ||
      company.docPrimaryColor?.toLowerCase() !== platform.docPrimaryColor;

    if (needsPersist) {
      await prisma.company.update({
        where: { id: company.id },
        data: {
          brandMode: 'abexcore',
          brandPrimary: platform.brandPrimary,
          brandAccent: platform.brandAccent,
          docPrimaryColor: platform.docPrimaryColor,
        },
      });
    }

    return {
      brandMode: 'abexcore',
      brandPrimary: platform.brandPrimary,
      brandAccent: platform.brandAccent,
      docPrimaryColor: platform.docPrimaryColor,
    };
  }

  if (
    company.brandPrimary &&
    /^#[0-9A-Fa-f]{6}$/.test(company.brandPrimary) &&
    company.brandAccent &&
    /^#[0-9A-Fa-f]{6}$/.test(company.brandAccent) &&
    company.docPrimaryColor &&
    /^#[0-9A-Fa-f]{6}$/.test(company.docPrimaryColor)
  ) {
    return {
      brandMode: 'unique',
      brandPrimary: company.brandPrimary.toLowerCase(),
      brandAccent: company.brandAccent.toLowerCase(),
      docPrimaryColor: company.docPrimaryColor.toLowerCase(),
    };
  }

  const generated = generateCompanyBrandPalette(company.slug || company.id);
  const next = {
    brandMode: 'unique' as const,
    brandPrimary: company.brandPrimary || generated.brandPrimary,
    brandAccent: company.brandAccent || generated.brandAccent,
    docPrimaryColor: company.docPrimaryColor || generated.docPrimaryColor,
  };

  await prisma.company.update({
    where: { id: company.id },
    data: next,
  });

  return {
    brandMode: 'unique',
    brandPrimary: next.brandPrimary.toLowerCase(),
    brandAccent: next.brandAccent.toLowerCase(),
    docPrimaryColor: next.docPrimaryColor.toLowerCase(),
  };
}
