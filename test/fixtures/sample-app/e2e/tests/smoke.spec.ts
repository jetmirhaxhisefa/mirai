import { expect, test } from '@playwright/test';

// The one critical journey: log in, add a task, mark it done.
test('log in, add a task and complete it', async ({ page }) => {
  const title = `E2E task ${Date.now()}`;

  await page.goto('/');
  await page.getByLabel('Email').fill(process.env.E2E_EMAIL ?? 'demo@example.test');
  await page.getByLabel('Password').fill(process.env.E2E_PASSWORD ?? 'demo-password');
  await page.getByRole('button', { name: 'Log in' }).click();

  await expect(page.getByRole('heading', { name: /Tasks for/ })).toBeVisible();

  await page.getByLabel('New task').fill(title);
  await page.getByRole('button', { name: 'Add' }).click();
  const done = page.getByLabel(`Done: ${title}`);
  await expect(done).toBeVisible();

  // The checkbox changes only after the API confirms, so click and wait for the state.
  await done.click();
  await expect(done).toBeChecked();
  await expect(done).toBeDisabled();
});
