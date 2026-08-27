/** Platform owner identity — password must come from env (never hardcode production passwords). */
export const PLATFORM_OWNER_SLUG = process.env.PLATFORM_COMPANY_SLUG?.trim() || 'owner';
export const PLATFORM_OWNER_EMAIL =
  process.env.PLATFORM_OWNER_EMAIL?.trim().toLowerCase() || 'info.abexcore@gmail.com';

/** Local/CI fallback only — production must set PLATFORM_OWNER_PASSWORD. */
const DEV_FALLBACK_PASSWORD = 'CiOnly-ChangeMe-NotForProd!';

function resolvePlatformOwnerPassword(): string {
  const fromEnv = process.env.PLATFORM_OWNER_PASSWORD?.trim();
  if (fromEnv) return fromEnv;

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'PLATFORM_OWNER_PASSWORD must be set in production. Do not rely on source-code defaults.'
    );
  }

  return DEV_FALLBACK_PASSWORD;
}

export const PLATFORM_OWNER_DEFAULT_PASSWORD = resolvePlatformOwnerPassword();
