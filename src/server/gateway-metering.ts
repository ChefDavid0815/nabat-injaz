import { randomUUID } from 'node:crypto';
import { database } from './db';
import { gatewayRoute, type AiTier } from '@/domain/analysis/routing';
import type { GatewayUsage } from '@/domain/analysis/providers';

export class AiAllowanceError extends Error {
  readonly retryable = false;
  readonly stopWorker = true;
}
export async function reserveGeneration(jobId: string, organisationId: string) {
  const db = await database();
  const budget = Number(process.env.AI_MONTHLY_BUDGET_USD || '5');
  if (!Number.isFinite(budget) || budget <= 0)
    throw new AiAllowanceError('The AI budget is not configured.');
  return db.transaction(async (tx) => {
    // Serialize reservations across every workspace sharing this application's budget.
    await tx.query('SELECT pg_advisory_xact_lock(1742027)');
    const org = (
      await tx.query<{ ai_tier: AiTier }>(
        'SELECT o.ai_tier FROM organisations o JOIN analysis_jobs j ON j.organisation_id=o.id WHERE o.id=$1 AND j.id=$2',
        [organisationId, jobId],
      )
    ).rows[0];
    if (!org) throw new AiAllowanceError('The analysis workspace is unavailable.');
    const route = gatewayRoute(org.ai_tier);
    const daily = (
      await tx.query<{ count: number }>(
        "SELECT count(*)::int count FROM ai_generations WHERE organisation_id=$1 AND created_at>=date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'",
        [organisationId],
      )
    ).rows[0].count;
    if (daily >= route.dailyLimit)
      throw new AiAllowanceError(
        'The daily analysis allowance has been reached. Your photo is saved.',
      );
    const spent = Number(
      (
        await tx.query<{ spent: string }>(
          "SELECT coalesce(sum(coalesce(cost_usd,reserved_usd)),0) spent FROM ai_generations WHERE created_at>=date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'",
        )
      ).rows[0].spent,
    );
    // A conservative reservation, not a provider-enforced hard spending limit.
    const reservation = 25000 * route.input + 4000 * route.output;
    if (spent + reservation > budget)
      throw new AiAllowanceError('The monthly AI allowance has been reached. Your photo is saved.');
    const id = randomUUID();
    await tx.query(
      'INSERT INTO ai_generations(id,organisation_id,job_id,tier,model,reserved_usd) VALUES($1,$2,$3,$4,$5,$6)',
      [id, organisationId, jobId, route.tier, route.model, reservation],
    );
    return { id, route };
  });
}
export async function saveGenerationUsage(id: string, usage: GatewayUsage) {
  await (
    await database()
  ).query(
    'UPDATE ai_generations SET cost_usd=$2,cost_source=$3,input_tokens=$4,output_tokens=$5,cached_tokens=$6,reasoning_tokens=$7,generation_id=$8,duration_ms=$9 WHERE id=$1',
    [
      id,
      usage.costUsd,
      usage.costSource,
      usage.inputTokens,
      usage.outputTokens,
      usage.cachedTokens,
      usage.reasoningTokens,
      usage.generationId,
      usage.durationMs,
    ],
  );
}
export async function finishGeneration(id: string, failed = false) {
  // Uncertain failures retain the reservation, because an upstream call may have been billed.
  await (
    await database()
  ).query('UPDATE ai_generations SET status=$2,completed_at=now(),error=$3 WHERE id=$1', [
    id,
    failed ? 'failed' : 'completed',
    failed ? 'Analysis did not complete; any reported usage is retained.' : null,
  ]);
}
