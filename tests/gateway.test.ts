import { beforeAll, afterEach, describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import sharp from 'sharp';
import { database, migrate } from '../src/server/db';
import * as services from '../src/server/services';
import { uploadPhoto } from '../src/server/media';
import { runAnalysisBatch } from '../src/server/analysis';
import { reserveGeneration } from '../src/server/gateway-metering';
import { aiTier, gatewayRoute } from '../src/domain/analysis/routing';
import { DevelopmentVisionProvider } from '../src/domain/analysis/providers';
import type { Actor, VisionFeatures } from '../src/domain/types';

const mocks = vi.hoisted(() => ({ generate: vi.fn(), lookup: vi.fn() }));
vi.mock('ai', async (original) => ({
  ...(await original<typeof import('ai')>()),
  generateText: mocks.generate,
  createGateway: () => ({ getGenerationInfo: mocks.lookup }),
}));
let owner: Actor, species: string, image: Buffer, features: VisionFeatures;
beforeAll(async () => {
  process.env.NABAT_DATA_DIR = path.resolve(`data/test-gateway-${Date.now()}`);
  process.env.AI_PROVIDER = 'gateway';
  process.env.AI_MONTHLY_BUDGET_USD = '5';
  await migrate();
  owner = (
    await services.register({
      name: 'Gateway test owner',
      email: `gateway-${randomUUID()}@example.test`,
      password: 'TestPassword2026!',
    })
  ).actor;
  const org = (await services.createWorkspace(owner, { name: 'Catalog fixture', kind: 'personal' }))
    .id;
  species = (await services.catalog(owner, org)).species[0].id;
  image = await sharp({ create: { width: 120, height: 120, channels: 3, background: '#448855' } })
    .jpeg()
    .toBuffer();
  features = await new DevelopmentVisionProvider().analyse({
    image,
    mimeType: 'image/jpeg',
    note: 'Synthetic fixture',
  });
});
afterEach(() => {
  process.env.AI_MONTHLY_BUDGET_USD = '5';
  mocks.generate.mockReset();
  mocks.lookup.mockReset();
});
async function observation() {
  const org = (
    await services.createWorkspace(owner, {
      name: 'Gateway fixture',
      kind: 'business',
      ai_tier: 'enterprise',
    })
  ).id;
  const plant = (
    await services.createPlant(owner, org, { name: 'Gateway plant', speciesId: species })
  ).id;
  await uploadPhoto(owner, plant, image, 'Synthetic vision fixture', false);
  const job = (
    await (
      await database()
    ).query<{ id: string }>('SELECT id FROM analysis_jobs WHERE plant_id=$1', [plant])
  ).rows[0].id;
  return { org, plant, job };
}
function modelResult() {
  mocks.generate.mockResolvedValue({
    output: features,
    totalUsage: {
      inputTokens: 1000,
      outputTokens: 400,
      inputTokenDetails: { cacheReadTokens: 100 },
      outputTokenDetails: { reasoningTokens: 0 },
    },
    finalStep: { providerMetadata: { gateway: { generationId: 'gen_unit_fixture' } } },
  });
  mocks.lookup.mockResolvedValue({ totalCost: 0.002 });
}
describe('Gateway entitlements and spend accounting', () => {
  it('defaults every new business workspace to Free and stores real-response usage metadata', async () => {
    const o = await observation();
    modelResult();
    expect((await services.workspaces(owner)).find((w) => w.id === o.org)?.ai_tier).toBe('free');
    await expect(runAnalysisBatch(1, o.plant)).resolves.toBe(1);
    const request = mocks.generate.mock.calls[0][0];
    expect(request.model.modelId).toBe('openai/gpt-4.1-mini');
    expect(request.providerOptions.gateway).toMatchObject({
      user: o.org,
      tags: expect.arrayContaining(['tier:free']),
    });
    expect(request.providerOptions.openai.store).toBe(false);
    const row = (
      await (
        await database()
      ).query(
        'SELECT status,tier,input_tokens,output_tokens,cost_usd,cost_source FROM ai_generations WHERE job_id=$1',
        [o.job],
      )
    ).rows[0];
    expect(row).toMatchObject({
      status: 'completed',
      tier: 'free',
      input_tokens: 1000,
      output_tokens: 400,
      cost_source: 'gateway',
    });
    expect(Number(row.cost_usd)).toBe(0.002);
    expect((await services.plantDetails(owner, o.plant)).analyses).toHaveLength(1);
  });
  it('routes a trusted Pro entitlement to Sol without accepting tier changes from workspace settings', async () => {
    const o = await observation();
    await services.workspaceSettings(owner, o.org, {
      name: 'Unchanged tier',
      timezone: 'Asia/Dubai',
      ai_tier: 'enterprise',
    });
    expect((await services.workspaces(owner)).find((w) => w.id === o.org)?.ai_tier).toBe('free');
    await (await database()).query("UPDATE organisations SET ai_tier='pro' WHERE id=$1", [o.org]);
    modelResult();
    await runAnalysisBatch(1, o.plant);
    expect(mocks.generate.mock.calls[0][0].model.modelId).toBe('openai/gpt-6.1-sol');
    expect(mocks.generate.mock.calls[0][0].reasoning).toBe('low');
  });
  it('rejects a budget reservation before invoking the upstream model', async () => {
    const o = await observation();
    process.env.AI_MONTHLY_BUDGET_USD = '.0001';
    await expect(runAnalysisBatch(1, o.plant)).rejects.toMatchObject({
      retryable: false,
      stopWorker: true,
    });
    expect(mocks.generate).not.toHaveBeenCalled();
    expect((await services.plantDetails(owner, o.plant)).jobs[0].status).toBe('failed');
    expect(
      (await (await database()).query('SELECT id FROM ai_generations WHERE job_id=$1', [o.job]))
        .rows,
    ).toHaveLength(0);
  });
  it('keeps an uncertain charge reserved and does not automatically retry quota errors', async () => {
    const o = await observation();
    mocks.generate.mockRejectedValue(
      Object.assign(new Error('Gateway credit required'), { statusCode: 402 }),
    );
    await expect(runAnalysisBatch(1, o.plant)).rejects.toMatchObject({ retryable: false });
    const row = (
      await (
        await database()
      ).query('SELECT status,cost_usd,reserved_usd FROM ai_generations WHERE job_id=$1', [o.job])
    ).rows[0];
    expect(row.status).toBe('failed');
    expect(row.cost_usd).toBeNull();
    expect(Number(row.reserved_usd)).toBeGreaterThan(0);
    expect(mocks.generate).toHaveBeenCalledTimes(1);
  });
  it('runs against the older optional agent schema and rejects cross-workspace reservations', async () => {
    const o = await observation(),
      other = await observation(),
      db = await database();
    await expect(reserveGeneration(o.job, other.org)).rejects.toMatchObject({ retryable: false });
    await db.exec('ALTER TABLE workspace_agent_dispatches RENAME TO agent_schema_not_installed');
    try {
      modelResult();
      await expect(runAnalysisBatch(1, o.plant)).resolves.toBe(1);
    } finally {
      await db.exec('ALTER TABLE agent_schema_not_installed RENAME TO workspace_agent_dispatches');
    }
    expect(() => aiTier('forged')).toThrow();
    expect(gatewayRoute('enterprise').model).toBe('openai/gpt-6-astra');
  });
});
