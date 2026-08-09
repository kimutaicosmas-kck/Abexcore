/** Fallback when a tenant has not set a custom login welcome message. */
export function resolveWelcomeMessage(
  companyName?: string | null,
  welcomeMessage?: string | null
): string {
  const custom = welcomeMessage?.trim();
  if (custom) return custom;
  const name = companyName?.trim();
  if (name) {
    return `Welcome to ${name}. Your team workspace is ready — let's make today count.`;
  }
  return 'Your workspace is ready. Let’s get to work.';
}
