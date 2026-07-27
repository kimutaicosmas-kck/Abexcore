import { test, expect } from '@playwright/test';

const adminEmail = process.env.E2E_ADMIN_EMAIL || 'kimutaicosmas547@gmail.com';
const adminPassword = process.env.E2E_ADMIN_PASSWORD || 'Kimutai@44!';

test.describe('ApexCore ERP smoke', () => {
  test('login page loads', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
  });

  test('admin can sign in and reach dashboard', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(adminEmail);
    await page.getByLabel('Password').fill(adminPassword);
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByText('Sales Today').first()).toBeVisible({ timeout: 15_000 });
  });

  test('finance module loads reconciliation tab', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(adminEmail);
    await page.getByLabel('Password').fill(adminPassword);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Sales Today').first()).toBeVisible({ timeout: 15_000 });

    await page.goto('/finance');
    await expect(page.getByRole('button', { name: 'Overview' })).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: 'Reconciliation' }).click();
    await expect(
      page.getByText(/Bank Balance|Unreconciled|Import bank statement/i).first()
    ).toBeVisible({ timeout: 10_000 });
  });
});
