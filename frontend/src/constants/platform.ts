/** Platform owner company slug — only this tenant can register new companies. */
export const PLATFORM_COMPANY_SLUG =
  (import.meta.env.VITE_PLATFORM_COMPANY_SLUG as string | undefined)?.trim() || 'owner';

export function isPlatformCompanySlug(slug?: string | null): boolean {
  if (!slug) return false;
  return slug.trim().toLowerCase() === PLATFORM_COMPANY_SLUG.toLowerCase();
}
