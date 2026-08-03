import { test, expect } from '@playwright/test';

const companySlug = process.env.E2E_COMPANY_SLUG || 'owner';
const adminEmail = process.env.E2E_ADMIN_EMAIL || 'kimutaicosmas547@gmail.com';
const adminPassword = process.env.E2E_ADMIN_PASSWORD || 'Kimutai@44!';

async function signIn(page: import('@playwright/test').Page) {
  await page.goto(`/login?tenant=${encodeURIComponent(companySlug)}`);
  // Tenant query pre-fills company; still fill if the field is visible.
  const company = page.getByLabel('Company code');
  if (await company.isVisible().catch(() => false)) {
    await company.fill(companySlug);
  }
  await page.getByLabel('Email').fill(adminEmail);
  await page.getByLabel('Password').fill(adminPassword);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).not.toHaveURL(/\/login/);
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
    await expect(page.getByRole('button', { name: 'Overview' })).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: 'Reconciliation' }).click();
    await expect(
      page.getByText(/Bank Balance|Unreconciled|Import bank statement/i).first()
    ).toBeVisible({ timeout: 10_000 });
  });
});
