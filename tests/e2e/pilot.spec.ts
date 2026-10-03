import { test, expect } from '@playwright/test';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
const email = `pilot-${Date.now()}@test.nabat`;
let plantId: string, orgId: string, token: string, tagId: string;
test.describe.serial('first pilot plant lifecycle', () => {
  test('register, create workspace and first plant, then provision a printable identity', async ({
    page,
  }) => {
    await page.goto('/register');
    await page.getByLabel('Your name').fill('Pilot Test Owner');
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByLabel('Password').fill('NabatPilotTest2026!');
    await page.getByRole('button', { name: 'Create account', exact: true }).click();
    await expect(page).toHaveURL(/onboarding/);
    await page.getByRole('radio', { name: /Organisation/ }).click();
    await page.getByLabel('Workspace name').fill('NABAT Test Nursery');
    await page.getByLabel('First location').fill('Propagation bench');
    await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
    await page.getByLabel('Plant name').fill('Pilot Monstera');
    await page
      .getByRole('combobox', { name: 'Species', exact: true })
      .selectOption({ label: 'Monstera' });
    await page
      .getByRole('combobox', { name: 'Location', exact: true })
      .selectOption({ label: 'Propagation bench' });
    await page.getByRole('button', { name: 'Add plant', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Your plant is ready to be tagged.' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Open tag provisioning' }).click();
    await expect(page).toHaveURL(/app\/tags/);
    await expect(page.getByRole('heading', { name: 'Pilot Monstera', exact: true })).toBeVisible();
    const bootstrap = await (await page.request.get('/api/bootstrap')).json();
    orgId = bootstrap.workspace.id;
    const tags = await (await page.request.get(`/api/workspaces/${orgId}/tags`)).json();
    plantId = tags[0].plant_id;
    tagId = tags[0].id;
    token = tags[0].public_token;
    const artwork = await page.request.get(`/api/tags/${tagId}/artwork`);
    expect(artwork.status()).toBe(200);
    expect(artwork.headers()['content-type']).toContain('image/svg+xml');
    expect(await artwork.text()).toContain('Tap NFC or scan QR');
    await page.context().storageState({ path: 'test-results/pilot-state.json' });
    await page.goto('/app/locations');
    for (const locationName of ['Gallery', 'Patio']) {
      await page.getByRole('button', { name: 'Create location', exact: true }).click();
      await page
        .getByRole('dialog')
        .getByRole('textbox', { name: 'Name', exact: true })
        .fill(locationName);
      await page
        .getByRole('dialog')
        .getByRole('button', { name: 'Create location', exact: true })
        .click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(page.getByRole('heading', { name: locationName, exact: true })).toBeVisible();
    }
  });
  test('NFC route, one-tap care and optional details survive reload', async ({ page }) => {
    await page
      .context()
      .addCookies(JSON.parse(await fs.readFile('test-results/pilot-state.json', 'utf8')).cookies);
    const alternate = await page.request.post('/api/workspaces', {
      headers: { Origin: 'http://localhost:3000' },
      data: { name: 'Other test workspace', kind: 'personal' },
    });
    expect(alternate.status()).toBe(201);
    await page.goto(`/p/${token}`);
    await expect(page.getByRole('heading', { name: 'Pilot Monstera', exact: true })).toBeVisible();
    await expect
      .poll(async () => (await (await page.request.get('/api/bootstrap')).json()).workspace.id)
      .toBe(orgId);
    await page.getByRole('button', { name: 'Watered', exact: true }).first().click();
    await expect(page.getByText('Watered recorded.', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Add details', exact: true }).click();
    await page.getByLabel('Amount (ml)').fill('275');
    await page.getByLabel('Note', { exact: true }).fill('Checked the soil before watering.');
    await page.getByRole('button', { name: 'Save care', exact: true }).click();
    await page.reload();
    const details = await (await page.request.get(`/api/plants/${plantId}`)).json();
    expect(details.timeline.filter((e: { type: string }) => e.type === 'watered')).toHaveLength(1);
    expect(details.timeline.find((e: { type: string }) => e.type === 'watered').note).toContain(
      '275 ml',
    );
  });
  test('camera/library observation completes durable development analysis and private media', async ({
    page,
  }) => {
    await page
      .context()
      .addCookies(
        JSON.parse(
          await (
            await import('node:fs/promises')
          ).readFile('test-results/pilot-state.json', 'utf8'),
        ).cookies,
      );
    await page.goto(`/app/plants/${plantId}`);
    await page.getByRole('button', { name: 'Add observation', exact: true }).first().click();
    await page
      .locator('input[type="file"]')
      .nth(1)
      .setInputFiles(path.resolve('public/images/monstera.webp'));
    await page.getByLabel('Note', { exact: true }).fill('First pilot observation.');
    await page.getByLabel('Same viewpoint and similar lighting').check();
    await page.getByRole('button', { name: 'Upload observation', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect
      .poll(
        async () => {
          const d = await (await page.request.get(`/api/plants/${plantId}`)).json();
          return d.analyses.length;
        },
        { timeout: 30000 },
      )
      .toBe(1);
    const d = await (await page.request.get(`/api/plants/${plantId}`)).json();
    expect(d.plant.score).toBeGreaterThanOrEqual(0);
    expect(d.plant.trend).toBe('baseline');
    expect(d.analyses[0].provider).toBe('development-fixture');
    const media = await page.request.get(d.plant.image);
    expect(media.status()).toBe(200);
    expect(media.headers()['cache-control']).toContain('no-store');
  });
  test('public passport protects operational fields and tenant API denies outsiders', async ({
    browser,
    page,
  }) => {
    const outsider = await browser.newContext();
    const publicPage = await outsider.newPage();
    await publicPage.goto(`/p/${token}`);
    await expect(
      publicPage.getByRole('heading', { name: 'Pilot Monstera', exact: true }),
    ).toBeVisible();
    await expect(publicPage.getByText('Propagation bench', { exact: true })).toHaveCount(0);
    await expect(publicPage.getByText('First pilot observation.', { exact: true })).toHaveCount(0);
    await expect(publicPage.getByRole('button', { name: 'Watered', exact: true })).toHaveCount(0);
    expect((await outsider.request.get(`/api/plants/${plantId}`)).status()).toBe(401);
    await outsider.close();
    await page
      .context()
      .addCookies(
        JSON.parse(
          await (
            await import('node:fs/promises')
          ).readFile('test-results/pilot-state.json', 'utf8'),
        ).cookies,
      );
    const csrf = await page.request.post(`/api/plants/${plantId}/care`, {
      headers: { Origin: 'https://hostile.example' },
      data: { type: 'watered', idempotencyKey: randomUUID() },
    });
    expect(csrf.status()).toBe(403);
  });
  test('fleet filters, mobile actions, RTL and reduced motion remain usable', async ({ page }) => {
    await page
      .context()
      .addCookies(
        JSON.parse(
          await (
            await import('node:fs/promises')
          ).readFile('test-results/pilot-state.json', 'utf8'),
        ).cookies,
      );
    await page.goto('/app/plants');
    await page.getByRole('textbox', { name: 'Search plants', exact: true }).fill('Pilot');
    await expect(page.locator('.fleet-row')).toHaveCount(1);
    await page.getByRole('button', { name: 'Card view' }).click();
    await expect(page.locator('.plant-card')).toHaveCount(1);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`/p/${token}`);
    await expect(
      page.locator('.profile-dock').getByRole('button', { name: 'Watered', exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(
      await page.locator('.identity-acquired').evaluate((e) => getComputedStyle(e).animationName),
    ).toBe('none');
    await page.goto('/app/settings');
    await page.getByRole('button', { name: 'العربية', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'الإعدادات', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'English', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  });
  test('tag replacement retires the old URL while history stays accessible', async ({ page }) => {
    await page
      .context()
      .addCookies(
        JSON.parse(
          await (
            await import('node:fs/promises')
          ).readFile('test-results/pilot-state.json', 'utf8'),
        ).cookies,
      );
    await page.goto('/app/tags');
    await page.getByRole('button', { name: 'Replace tag', exact: true }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Replace tag', exact: true })
      .click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.goto(`/p/${token}`);
    await expect(page.getByRole('heading', { name: 'This tag has been retired.' })).toBeVisible();
    await page.goto(`/app/plants/${plantId}`);
    await expect(page.getByRole('heading', { name: 'Pilot Monstera', exact: true })).toBeVisible();
    const details = await (await page.request.get(`/api/plants/${plantId}`)).json();
    expect(details.analyses).toHaveLength(1);
    expect(details.timeline.some((e: { type: string }) => e.type === 'watered')).toBe(true);
  });
});
