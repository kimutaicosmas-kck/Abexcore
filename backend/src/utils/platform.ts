import { config } from '../config';

export function isPlatformCompanySlug(slug?: string | null): boolean {
  if (!slug) return false;
  return slug.trim().toLowerCase() === config.platformCompanySlug.toLowerCase();
}

export function sanitizeCompanyBrand<T extends { slug?: string | null; logo?: string | null }>(company: T): T {
  if (isPlatformCompanySlug(company.slug)) {
    return { ...company, logo: null };
  }
  return company;
}
