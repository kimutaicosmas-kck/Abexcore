import { test, expect } from '@playwright/test';

const companySlug = process.env.E2E_COMPANY_SLUG || 'owner';
const adminEmail = process.env.E2E_ADMIN_EMAIL || 'kimutaicosmas547@gmail.com';
const adminPassword = process.env.E2E_ADMIN_PASSWORD || 'Kimutai@44!';

async function signIn(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();

  await page.getByLabel('Company code').fill(companySlug);
  await page.getByLabel('Email').fill(adminEmail);
  await page.getByLabel('Password').fill(adminPassword);

  const signIn = page.getByRole('button', { name: 'Sign in' });
  await expect(signIn).toBeEnabled();
  await signIn.click();

  // Surface login errors instead of timing out on the dashboard.
  const alert = page.locator('[role="alert"], .text-red-600, .text-red-700').first();
  await Promise.race([
    page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 20_000 }),
    alert.waitFor({ state: 'visible', timeout: 20_000 }).then(async () => {
      throw new Error(`Login failed: ${(await alert.textContent())?.trim() || 'unknown error'}`);
    }),
  ]);

  // Dismiss post-login welcome overlay if present (blocks dashboard assertions).
  const welcome = page.getByRole('dialog', { name: /Welcome back/i });
  if (await welcome.isVisible().catch(() => false)) {
    await page.keyboard.press('Escape');
    await expect(welcome).toBeHidden({ timeout: 5_000 });
  }

  await expect(page.getByText(/Sales today/i).first()).toBeVisible({ timeout: 20_000 });
}

test.describe('AbexCore ERP smoke', () => {
  test('login page loads', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByLabel('Company code')).toBeVisible();
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
  });

  test('admin can sign in and reach dashboard', async ({ page }) => {
    await signIn(page);
  });

  test('finance module loads reconciliation tab', async ({ page }) => {
    await signIn(page);

    await page.goto('/finance');
    await expect(page.getByRole('button', { name: 'Reconciliation' })).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: 'Reconciliation' }).click();
    await expect(
      page.getByText(/Bank Balance|Unreconciled|Import bank statement/i).first()
    ).toBeVisible({ timeout: 15_000 });
  });
});
