import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
test('primary public and operational screens pass automated WCAG AA checks', async ({ page }) => {
  const inspect = async () => {
    const result = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .exclude('nextjs-portal')
      .analyze();
    expect(
      result.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary })),
      })),
    ).toEqual([]);
  };
  await page.goto('/');
  await inspect();
  const login = await page.request.post('/api/auth/login', {
    headers: { Origin: new URL(page.url()).origin },
    data: { email: 'owner@nabat.demo', password: 'NabatDemo2026!' },
  });
  expect(login.status()).toBe(200);
  const bootstrap = await (await page.request.get('/api/bootstrap')).json();
  const collection = await (
    await page.request.get(`/api/workspaces/${bootstrap.workspace.id}/plants`)
  ).json();
  for (const route of [
    '/app',
    '/app/plants',
    `/app/plants/${collection.items[0].id}`,
    '/app/settings',
    '/app/tags',
  ]) {
    await page.goto(route);
    await page.getByRole('heading', { level: 1 }).waitFor();
    if (route === '/app/plants') await page.locator('.fleet-row').first().waitFor();
    if (route === '/app/tags') await page.locator('.tag-card').first().waitFor();
    await inspect();
  }
});
