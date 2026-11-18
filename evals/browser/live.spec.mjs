import { test, expect } from '@playwright/test';

test('published dashboard compares real archived drivers', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('./#race/2025/24/strategy?a=max_verstappen&b=piastri');
  await expect(page.getByRole('heading', { name: 'Race Strategy Lab', exact: true })).toBeVisible({ timeout: 55_000 });
  await expect(page.getByRole('table', { name: 'Compared tyre stints' })).toContainText('PIA');
  await expect(page.getByRole('table', { name: 'Compared pit windows' })).toContainText('VER');
  await expect(page.getByRole('heading', { name: 'Matched-lap pace delta' })).toBeVisible();
  await page.getByLabel('Compare with', { exact: true }).selectOption('norris');
  await expect(page.getByRole('table', { name: 'Compared tyre stints' })).toContainText('NOR');
  await page.reload();
  await expect(page.getByLabel('Compare with', { exact: true })).toHaveValue('norris');
  await expect(page.getByRole('table', { name: 'Compared tyre stints' })).toContainText('NOR', { timeout: 55_000 });
  await page.getByRole('button', { name: 'Telemetry', exact: true }).click();
  await expect(page.getByRole('img', { name: 'Speed by elapsed lap time' })).toBeVisible({ timeout: 45_000 });
  await expect(page.getByRole('button', { name: /Download CSV · Lando Norris · Lap/ })).toBeVisible();
  await page.getByLabel('VER lap', { exact: true }).selectOption('10');
  await expect(page.getByRole('button', { name: 'Download CSV · Max Verstappen · Lap 10' })).toBeVisible({ timeout: 30_000 });
  await expect(page).toHaveURL(/lapA=10/);
  await page.getByRole('button', { name: 'Qualifying', exact: true }).click();
  const classification = page.getByRole('table', { name: 'Qualifying results and race position changes' });
  await expect(classification.getByRole('row', { name: /Max Verstappen/ })).toContainText('1:22.207', { timeout: 30_000 });
  expect(errors).toEqual([]);
});
