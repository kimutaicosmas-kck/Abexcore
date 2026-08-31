import prisma from '../config/database';
import { generateCompanyBrandPalette } from './companyBrandPalette';
import { isPlatformCompanySlug } from './platform';

/** Persist a unique palette when a company has none yet (registration or legacy tenants). */
export async function ensureCompanyBrandColors(company: {
  id: string;
  slug: string;
  brandPrimary?: string | null;
  brandAccent?: string | null;
  docPrimaryColor?: string | null;
}): Promise<{
  brandPrimary: string;
  brandAccent: string;
  docPrimaryColor: string;
}> {
  if (
    company.brandPrimary &&
    /^#[0-9A-Fa-f]{6}$/.test(company.brandPrimary) &&
    company.brandAccent &&
    /^#[0-9A-Fa-f]{6}$/.test(company.brandAccent) &&
    company.docPrimaryColor &&
    /^#[0-9A-Fa-f]{6}$/.test(company.docPrimaryColor)
  ) {
    return {
      brandPrimary: company.brandPrimary.toLowerCase(),
      brandAccent: company.brandAccent.toLowerCase(),
      docPrimaryColor: company.docPrimaryColor.toLowerCase(),
    };
  }

  if (isPlatformCompanySlug(company.slug)) {
    const platform = {
      brandPrimary: '#2563eb',
      brandAccent: '#0284c7',
      docPrimaryColor: '#1e6bb8',
    };
    if (!company.brandPrimary || !company.brandAccent || !company.docPrimaryColor) {
      await prisma.company.update({
        where: { id: company.id },
        data: {
          brandPrimary: company.brandPrimary || platform.brandPrimary,
          brandAccent: company.brandAccent || platform.brandAccent,
          docPrimaryColor: company.docPrimaryColor || platform.docPrimaryColor,
        },
      });
    }
    return {
      brandPrimary: (company.brandPrimary || platform.brandPrimary).toLowerCase(),
      brandAccent: (company.brandAccent || platform.brandAccent).toLowerCase(),
      docPrimaryColor: (company.docPrimaryColor || platform.docPrimaryColor).toLowerCase(),
    };
  }

  const generated = generateCompanyBrandPalette(company.slug || company.id);
  const next = {
    brandPrimary: company.brandPrimary || generated.brandPrimary,
    brandAccent: company.brandAccent || generated.brandAccent,
    docPrimaryColor: company.docPrimaryColor || generated.docPrimaryColor,
  };

  await prisma.company.update({
    where: { id: company.id },
    data: next,
  });

  return {
    brandPrimary: next.brandPrimary.toLowerCase(),
    brandAccent: next.brandAccent.toLowerCase(),
    docPrimaryColor: next.docPrimaryColor.toLowerCase(),
  };
}
