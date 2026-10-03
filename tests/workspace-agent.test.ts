import { beforeAll, afterEach, describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import sharp from 'sharp';
import { database, migrate } from '../src/server/db';
import * as services from '../src/server/services';
import { uploadPhoto } from '../src/server/media';
import { runAnalysisBatch } from '../src/server/analysis';
import { agentObservation, agentCompleteObservation } from '../src/server/workspace-agent';
import { workspaceAgentMcp } from '../src/server/workspace-agent-mcp';
import { DevelopmentVisionProvider } from '../src/domain/analysis/providers';
import type { Actor, VisionFeatures } from '../src/domain/types';

let owner: Actor,
  otherOwner: Actor,
  org: string,
  otherOrg: string,
  species: string,
  image: Buffer,
  features: VisionFeatures;
beforeAll(async () => {
  process.env.NABAT_DATA_DIR = path.resolve(`data/test-agent-${Date.now()}`);
  process.env.SESSION_SECRET = 'workspace-agent-test-signing-secret-not-production';
  process.env.WORKSPACE_AGENT_TRIGGER_ID = 'agtch_unit_fixture';
  process.env.WORKSPACE_AGENT_ACCESS_TOKEN = 'unit-fixture-token-no-real-account';
  process.env.AI_PROVIDER = 'workspace-agent';
  process.env.WORKSPACE_AGENT_BUDGET_CONFIRMED = 'true';
  await migrate();
  owner = (
    await services.register({
      name: 'Agent scope owner',
      email: `agent-${randomUUID()}@example.test`,
      password: 'TestPassword2026!',
    })
  ).actor;
  otherOwner = (
    await services.register({
      name: 'Other scope owner',
      email: `agent-${randomUUID()}@example.test`,
      password: 'TestPassword2026!',
    })
  ).actor;
  org = (await services.createWorkspace(owner, { name: 'Agent-owned fixture', kind: 'business' }))
    .id;
  otherOrg = (
    await services.createWorkspace(otherOwner, { name: 'Unrelated fixture', kind: 'business' })
  ).id;
  process.env.WORKSPACE_AGENT_NABAT_WORKSPACE_ID = org;
  species = (await services.catalog(owner, org)).species[0].id;
  image = await sharp({ create: { width: 120, height: 120, channels: 3, background: '#448855' } })
    .jpeg()
    .toBuffer();
  features = await new DevelopmentVisionProvider().analyse({
    image,
    mimeType: 'image/jpeg',
    note: 'Synthetic unit fixture',
  });
});
afterEach(() => vi.unstubAllGlobals());
async function observation(actor = owner, workspace = org) {
  const plant = (
    await services.createPlant(actor, workspace, { name: 'Agent fixture', speciesId: species })
  ).id;
  const photo = await uploadPhoto(actor, plant, image, 'Synthetic integration fixture', false);
  return { plant, photo };
}
function accepted() {
  return Response.json(
    {
      conversation_url: 'https://chatgpt.com/c/fixture',
      agent_trigger_run_id: 'apirun_unit_fixture',
    },
    { status: 202 },
  );
}
const triggerInput = (mock: ReturnType<typeof vi.fn>, index = 0) =>
  JSON.parse(JSON.parse(mock.mock.calls[index][1].body).input);

describe('Workspace Agent dispatch and job-scoped capabilities', () => {
  it('discovers two MCP tools without exposing any private photo', async () => {
    const request = new Request('http://localhost:3000/api/workspace-agent/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    const response = await workspaceAgentMcp.fetch(request);
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(body).toContain('get_observation_for_analysis');
    expect(body).toContain('submit_observation_analysis');
    expect(body).not.toContain(image.toString('base64'));
    expect(body).not.toContain(process.env.WORKSPACE_AGENT_ACCESS_TOKEN);
  });
  it('dispatches only the configured workspace and treats 202 as queued work, not completed analysis', async () => {
    const other = await observation(otherOwner, otherOrg);
    const own = await observation();
    const fetcher = vi.fn(async () => accepted());
    vi.stubGlobal('fetch', fetcher);
    expect(await runAnalysisBatch(1)).toBe(1);
    const input = triggerInput(fetcher);
    expect(input.requested_model).toBe('gpt-5.6-luna');
    expect(input.capability).toHaveLength(43);
    const jobs = (
      await (
        await database()
      ).query<{ photo_id: string; status: string }>(
        'SELECT photo_id,status FROM analysis_jobs WHERE photo_id=ANY($1::uuid[])',
        [[own.photo.id, other.photo.id]],
      )
    ).rows;
    expect(jobs.find((j) => j.photo_id === own.photo.id)?.status).toBe('processing');
    expect(jobs.find((j) => j.photo_id === other.photo.id)?.status).toBe('queued');
    expect(
      (
        await (
          await database()
        ).query('SELECT id FROM visual_analyses WHERE photo_id=$1', [own.photo.id])
      ).rows,
    ).toHaveLength(0);
    const photo = await agentObservation({ job_id: input.job_id, capability: input.capability });
    expect(photo.image.byteLength).toBeGreaterThan(30);
    expect(photo.context.untrusted_note).toContain('Synthetic');
    await expect(
      agentObservation({ job_id: input.job_id, capability: 'x'.repeat(43) }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      agentCompleteObservation({
        job_id: input.job_id,
        capability: input.capability,
        features: {},
      }),
    ).rejects.toThrow();
    expect(
      await agentCompleteObservation({
        job_id: input.job_id,
        capability: input.capability,
        features,
      }),
    ).toMatchObject({ saved: true });
    expect(
      await agentCompleteObservation({
        job_id: input.job_id,
        capability: input.capability,
        features,
      }),
    ).toEqual({ saved: true, duplicate: true });
    const detail = await services.plantDetails(owner, own.plant);
    expect(detail.analyses).toHaveLength(1);
    expect(detail.history).toHaveLength(1);
    expect(detail.analyses[0]).toMatchObject({
      provider: 'chatgpt-workspace-agent',
      model: 'gpt-5.6-luna',
    });
  });
  it('retries uncertain trigger acceptance with the same event key and capability', async () => {
    await observation();
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error('Lost response'))
      .mockResolvedValueOnce(accepted());
    vi.stubGlobal('fetch', fetcher);
    await runAnalysisBatch(1);
    const first = triggerInput(fetcher);
    await (
      await database()
    ).query('UPDATE workspace_agent_dispatches SET next_action_at=now() WHERE job_id=$1', [
      first.job_id,
    ]);
    await runAnalysisBatch(0);
    expect(fetcher.mock.calls[1][1].headers['Idempotency-Key']).toBe(
      fetcher.mock.calls[0][1].headers['Idempotency-Key'],
    );
    expect(fetcher.mock.calls[1][1].body).toBe(fetcher.mock.calls[0][1].body);
    await agentCompleteObservation({
      job_id: first.job_id,
      capability: first.capability,
      features,
    });
  });
  it('rejects expired capabilities and capabilities for a transferred plant', async () => {
    const own = await observation();
    const fetcher = vi.fn(async () => accepted());
    vi.stubGlobal('fetch', fetcher);
    await runAnalysisBatch(1);
    const input = triggerInput(fetcher);
    const transfer = await services.requestTransfer(owner, own.plant, otherOrg);
    await services.acceptTransfer(otherOwner, transfer.id);
    await expect(
      agentObservation({ job_id: input.job_id, capability: input.capability }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      agentCompleteObservation({ job_id: input.job_id, capability: input.capability, features }),
    ).rejects.toMatchObject({ status: 403 });
    await observation();
    await runAnalysisBatch(1);
    const latest = triggerInput(fetcher, 1);
    await (
      await database()
    ).query(
      "UPDATE workspace_agent_dispatches SET expires_at=now()-interval '1 minute' WHERE job_id=$1",
      [latest.job_id],
    );
    await expect(
      agentObservation({ job_id: latest.job_id, capability: latest.capability }),
    ).rejects.toMatchObject({ status: 403 });
    await (
      await database()
    ).query('UPDATE workspace_agent_dispatches SET next_action_at=now() WHERE job_id=$1', [
      latest.job_id,
    ]);
    await runAnalysisBatch(0);
    expect(
      (
        await (
          await database()
        ).query<{ status: string }>('SELECT status FROM analysis_jobs WHERE id=$1', [latest.job_id])
      ).rows[0].status,
    ).toBe('failed');
  });
  it('shows approval suspension and fails a completed run that never saved features', async () => {
    await observation();
    const fetcher = vi.fn(async () => accepted());
    vi.stubGlobal('fetch', fetcher);
    await runAnalysisBatch(1);
    const input = triggerInput(fetcher);
    fetcher.mockImplementation(async () => Response.json({ status: 'suspended' }));
    await (
      await database()
    ).query('UPDATE workspace_agent_dispatches SET next_action_at=now() WHERE job_id=$1', [
      input.job_id,
    ]);
    await runAnalysisBatch(0);
    expect(
      (
        await (
          await database()
        ).query<{ remote_status: string }>(
          'SELECT remote_status FROM workspace_agent_dispatches WHERE job_id=$1 AND active',
          [input.job_id],
        )
      ).rows[0].remote_status,
    ).toBe('suspended');
    fetcher.mockImplementation(async () => Response.json({ status: 'completed' }));
    await (
      await database()
    ).query(
      "UPDATE workspace_agent_dispatches SET next_action_at=now(),completed_seen_at=now()-interval '3 minutes' WHERE job_id=$1",
      [input.job_id],
    );
    await runAnalysisBatch(0);
    expect(
      (
        await (
          await database()
        ).query<{ status: string; error: string }>(
          'SELECT status,error FROM analysis_jobs WHERE id=$1',
          [input.job_id],
        )
      ).rows[0],
    ).toMatchObject({ status: 'failed', error: expect.stringContaining('without submitting') });
  });
  it('pauses new dispatches after a trigger authorization rejection', async () => {
    await observation();
    await observation();
    const leakedCapability = 'b'.repeat(43);
    const fetcher = vi.fn(async () =>
      Response.json(
        {
          error: {
            code: 'api_trigger_denied',
            message: `The agent is not runnable. Bearer test-secret-token ${leakedCapability}`,
          },
        },
        { status: 403 },
      ),
    );
    vi.stubGlobal('fetch', fetcher);
    expect(await runAnalysisBatch(5)).toBe(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const error = (
      await (
        await database()
      ).query<{ error: string }>(
        "SELECT error FROM analysis_jobs WHERE status='failed' AND error LIKE '%api_trigger_denied%' LIMIT 1",
      )
    ).rows[0].error;
    expect(error).toContain('api_trigger_denied');
    expect(error).toContain('not runnable');
    expect(error).not.toContain('test-secret-token');
    expect(error).not.toContain(leakedCapability);
    expect(await runAnalysisBatch(5)).toBe(0);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
