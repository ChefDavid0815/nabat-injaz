import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';

test('mobile offline care rejoins maintenance once and is readable by the native contract', async ({
  page,
}) => {
  await page.goto('/login');
  const origin = new URL(page.url()).origin;
  expect(
    (
      await page.request.post('/api/auth/login', {
        headers: { Origin: origin },
        data: { email: 'owner@nabat.demo', password: 'NabatDemo2026!' },
      })
    ).status(),
  ).toBe(200);
  const bootstrap = await (await page.request.get('/api/bootstrap')).json();
  const org = bootstrap.workspace.id;
  const title = 'Offline inspection ' + randomUUID().slice(0, 8);
  const post = async (route: string, data: unknown) => {
    const response = await page.request.post(`/api/v1/operations/${org}/${route}`, {
      headers: { Origin: origin },
      data,
    });
    expect(response.status(), await response.text()).toBeLessThan(300);
    return response.json();
  };
  const catalog = await (await page.request.get(`/api/v1/operations/${org}/catalog`)).json();
  const created = await post('plants', {
    name: 'Offline flow ' + randomUUID().slice(0, 8),
    speciesId: catalog.species[0].id,
    locationId: catalog.locations[0].id,
  });
  const task = await post('tasks', {
    plantId: created.id,
    kind: 'inspected',
    title,
    dueAt: new Date().toISOString(),
    assigneeId: bootstrap.actor.id,
    idempotencyKey: randomUUID(),
  });
  const session = await post('sessions', { plantIds: [created.id], idempotencyKey: randomUUID() });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app/today');
  const row = page.locator('.operations-task').filter({ hasText: title });
  await expect(row).toBeVisible();
  await expect(page.locator('.operations-sync')).toContainText('Synced');
  await page.context().setOffline(true);
  await row.getByRole('button', { name: 'Log inspected', exact: true }).click();
  await expect(row).toContainText('Saved · pending sync');
  await expect(page.locator('.operations-sync')).toContainText('Working offline');
  await page.context().setOffline(false);
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(row).toContainText('Completed');
  await page.reload();
  await expect(page.locator('.operations-task').filter({ hasText: title })).toContainText(
    'Completed',
  );
  const detail = await (
    await page.request.get(`/api/v1/operations/${org}/sessions/${session.id}`)
  ).json();
  expect(
    detail.events.filter((event: { type: string }) => event.type === 'inspected'),
  ).toHaveLength(1);
  const key = detail.events.find(
    (event: { type: string }) => event.type === 'inspected',
  ).care_event_id;
  expect(key).toBeTruthy();
  const finish = await post(`sessions/${session.id}/finish`, {
    revision: 0,
    action: 'complete',
    idempotencyKey: randomUUID(),
  });
  expect(finish.summary.plants_visited).toBe(1);
  const native = await page.request.post('/api/v1/operations/session', {
    headers: { Origin: origin },
    data: { email: 'owner@nabat.demo', password: 'NabatDemo2026!' },
  });
  const identity = await native.json();
  const snapshot = await (
    await page.request.get(`/api/v1/operations/${org}/snapshot`, {
      headers: { Authorization: 'Bearer ' + identity.token },
    })
  ).json();
  expect(snapshot.contractVersion).toBe('operations/1.1');
  expect(snapshot.tasks.find((item: { id: string }) => item.id === task.id).status).toBe(
    'completed',
  );
  const tag = (await (await page.request.get(`/api/v1/operations/${org}/tags`)).json()).find(
    (item: { plant_id: string }) => item.plant_id === created.id,
  );
  const programmed = await post(`tags/${tag.id}/programming`, {
    reader: 'E2E simulated adapter',
    uid: '53494D',
    verification: 'simulated',
    url: tag.resolver_url,
    idempotencyKey: randomUUID(),
  });
  expect(programmed.verification).toBe('simulated');
  await page.goto('/p/' + tag.public_token);
  await expect(
    page.getByRole('heading', { name: created.name || /^Offline flow /, exact: false }),
  ).toBeVisible();
  await expect(page.locator('main')).toContainText('Inspected');
  const problems = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .exclude('nextjs-portal')
    .analyze();
  expect(problems.violations.map((v) => v.id)).toEqual([]);
});
