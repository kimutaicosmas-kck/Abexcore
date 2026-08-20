/** Default platform owner credentials and company code (override via env in production). */
export const PLATFORM_OWNER_SLUG = process.env.PLATFORM_COMPANY_SLUG?.trim() || 'owner';
export const PLATFORM_OWNER_EMAIL =
  process.env.PLATFORM_OWNER_EMAIL?.trim().toLowerCase() || 'info.abexcore@gmail.com';
export const PLATFORM_OWNER_DEFAULT_PASSWORD = process.env.PLATFORM_OWNER_PASSWORD || 'Kimutai@44!';
