import { randomUUID } from 'node:crypto';
import { database, type SqlClient } from './db';
import { storage } from './media';
import { visionProvider } from '@/domain/analysis/providers';
import { CONTRACT_VERSION, PROMPT_VERSION } from '@/domain/analysis/contract';
import { calculateHealth, warningRules, ENGINE_VERSION } from '@/domain/health/engine';
import type { VisionFeatures } from '@/domain/types';

export async function scorePlant(tx: SqlClient, plantId: string, analysisId: string) {
  const p = (
    await tx.query<{ organisation_id: string; watering_days: number; fertilising_days: number }>(
      'SELECT p.organisation_id,s.watering_days,s.fertilising_days FROM plants p JOIN plant_species s ON s.id=p.species_id WHERE p.id=$1',
      [plantId],
    )
  ).rows[0];
  const current = (
    await tx.query<{
      features: VisionFeatures;
      provider: string;
      model: string;
      captured_at: Date;
      original_metadata: { matchedView?: boolean };
    }>(
      'SELECT a.features,a.provider,a.model,ph.captured_at,ph.original_metadata FROM visual_analyses a JOIN plant_photos ph ON ph.id=a.photo_id WHERE a.id=$1 AND a.plant_id=$2',
      [analysisId, plantId],
    )
  ).rows[0];
  const previous =
    current.original_metadata.matchedView && current.features.comparable
      ? (
          await tx.query<{ features: VisionFeatures; id: string }>(
            `SELECT a.features,a.id FROM visual_analyses a JOIN plant_photos ph ON ph.id=a.photo_id WHERE a.plant_id=$1 AND a.id<>$2 AND a.provider=$3 AND a.model=$4 AND ph.captured_at < $5::timestamptz - interval '6 hours' AND ph.original_metadata->>'matchedView'='true' AND (a.features->>'comparable')::boolean=true AND (a.features->'image_quality'->>'value')::numeric>=.55 ORDER BY ph.captured_at DESC LIMIT 3`,
            [plantId, analysisId, current.provider, current.model, current.captured_at],
          )
        ).rows
      : [];
  const care = (
    await tx.query<{
      last_watered: Date | null;
      last_fertilised: Date | null;
      last_moved: Date | null;
    }>(
      "SELECT max(occurred_at) FILTER(WHERE type='watered') last_watered,max(occurred_at) FILTER(WHERE type='fertilised') last_fertilised,max(occurred_at) FILTER(WHERE type='moved') last_moved FROM care_events WHERE plant_id=$1",
      [plantId],
    )
  ).rows[0];
  const old = (
    await tx.query<{ score: number; engine_version: string; provider: string; model: string }>(
      'SELECT h.score,h.engine_version,a.provider,a.model FROM health_score_snapshots h LEFT JOIN visual_analyses a ON a.id=h.analysis_id WHERE h.plant_id=$1 ORDER BY h.created_at DESC LIMIT 1',
      [plantId],
    )
  ).rows[0];
  const snapshot = calculateHealth({
    current: current.features,
    analysisId,
    previous,
    previousScore:
      old?.engine_version === ENGINE_VERSION &&
      old.provider === current.provider &&
      old.model === current.model
        ? old.score
        : null,
    lastWatered: care.last_watered,
    lastFertilised: care.last_fertilised,
    lastMoved: care.last_moved,
    wateringDays: p.watering_days,
    fertilisingDays: p.fertilising_days,
    now: new Date(),
    observedAt: current.captured_at,
  });
  // Care reasons are explicitly linked to the source event, not merely to the score.
  const source = (
    await tx.query<{ id: string }>(
      "SELECT id FROM care_events WHERE plant_id=$1 AND type='watered' ORDER BY occurred_at DESC LIMIT 1",
      [plantId],
    )
  ).rows[0];
  for (const reason of snapshot.reasons)
    if (reason.kind === 'care') reason.sourceId = source?.id || null;
  await tx.query(
    'INSERT INTO health_score_snapshots(id,organisation_id,plant_id,analysis_id,score,delta,trend,confidence,composition,reasons,engine_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
    [
      randomUUID(),
      p.organisation_id,
      plantId,
      analysisId,
      snapshot.score,
      snapshot.delta,
      snapshot.trend,
      snapshot.confidence,
      JSON.stringify(snapshot.composition),
      JSON.stringify(snapshot.reasons),
      snapshot.engine_version,
    ],
  );
  const rules = warningRules(snapshot, current.features);
  for (const rule of rules) {
    const id = randomUUID();
    const added = await tx.query(
      `INSERT INTO alerts(id,organisation_id,plant_id,rule,severity,reason,recommended_action,source_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(plant_id,rule) WHERE status<>'resolved' DO NOTHING RETURNING id`,
      [
        id,
        p.organisation_id,
        plantId,
        rule.rule,
        rule.severity,
        rule.reason,
        rule.action,
        analysisId,
      ],
    );
    if (added.rows.length)
      await tx.query("INSERT INTO alert_status_events(id,alert_id,status) VALUES($1,$2,'open')", [
        randomUUID(),
        id,
      ]);
  }
  return snapshot;
}

export async function runAnalysisBatch(
  limit = 3,
  plantId?: string,
  deadlineAt = Infinity,
  organisationId?: string,
) {
  const db = await database();
  let count = 0;
  await db.query(
    "UPDATE analysis_jobs SET status='failed',locked_at=null,error='Processing lease expired after the final attempt.' WHERE status='processing' AND attempts>=3 AND locked_at<now()-interval '5 minutes' AND ($1::uuid IS NULL OR plant_id=$1) AND ($2::uuid IS NULL OR organisation_id=$2)",
    [plantId || null, organisationId || null],
  );
  for (let i = 0; i < limit; i++) {
    if (Date.now() >= deadlineAt) break;
    const job = await db.transaction(async (tx) => {
      const row = (
        await tx.query<{
          id: string;
          photo_id: string;
          plant_id: string;
          organisation_id: string;
          attempts: number;
        }>(
          `SELECT id,photo_id,plant_id,organisation_id,attempts FROM analysis_jobs WHERE attempts<3 AND ($1::uuid IS NULL OR plant_id=$1) AND ($2::uuid IS NULL OR organisation_id=$2) AND (status='queued' AND available_at<=now() OR status='processing' AND locked_at<now()-interval '5 minutes') ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1`,
          [plantId || null, organisationId || null],
        )
      ).rows[0];
      if (!row) return null;
      await tx.query(
        "UPDATE analysis_jobs SET status='processing',attempts=attempts+1,locked_at=now(),error=null WHERE id=$1",
        [row.id],
      );
      return { ...row, attempts: row.attempts + 1 };
    });
    if (!job) break;
    try {
      const photo = (
        await db.query<{ object_key: string; mime_type: string; note: string }>(
          'SELECT object_key,mime_type,note FROM plant_photos WHERE id=$1',
          [job.photo_id],
        )
      ).rows[0];
      const provider = visionProvider();
      const features = await provider.analyse({
        image: await storage().get(photo.object_key),
        mimeType: photo.mime_type,
        note: photo.note,
      });
      await db.transaction(async (tx) => {
        const lease = (
          await tx.query<{ status: string; attempts: number }>(
            'SELECT status,attempts FROM analysis_jobs WHERE id=$1 FOR UPDATE',
            [job.id],
          )
        ).rows[0];
        if (lease.status !== 'processing' || lease.attempts !== job.attempts) return;
        const plant = (
          await tx.query<{ organisation_id: string }>(
            'SELECT organisation_id FROM plants WHERE id=$1 FOR UPDATE',
            [job.plant_id],
          )
        ).rows[0];
        const id = randomUUID();
        await tx.query(
          'INSERT INTO visual_analyses(id,organisation_id,plant_id,photo_id,provider,model,contract_version,prompt_version,features,comparison) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
          [
            id,
            plant.organisation_id,
            job.plant_id,
            job.photo_id,
            provider.name,
            provider.model,
            CONTRACT_VERSION,
            PROMPT_VERSION,
            JSON.stringify(features),
            JSON.stringify({
              strategy: 'same-provider, confirmed viewpoint, quality gate, >=6h interval',
              version: 'comparison/1.0',
            }),
          ],
        );
        const snapshot = await scorePlant(tx, job.plant_id, id);
        await tx.query(
          'UPDATE visual_analyses SET comparison=comparison || $2::jsonb WHERE id=$1',
          [
            id,
            JSON.stringify({
              yellowingContribution: snapshot.composition.trajectory,
              confidence: snapshot.confidence,
              baselineBuilding: snapshot.trend === 'baseline',
            }),
          ],
        );
        await tx.query(
          "UPDATE analysis_jobs SET status='completed',completed_at=now(),locked_at=null WHERE id=$1",
          [job.id],
        );
      });
      count++;
      console.info(
        JSON.stringify({ event: 'analysis.completed', jobId: job.id, provider: provider.name }),
      );
    } catch (e) {
      console.error(
        JSON.stringify({
          event: 'analysis.failed',
          jobId: job.id,
          error: e instanceof Error ? e.message : 'Unknown error',
        }),
      );
      await db.query(
        "UPDATE analysis_jobs SET status=CASE WHEN attempts>=3 OR $4 THEN 'failed' ELSE 'queued' END,available_at=now()+interval '30 seconds',locked_at=null,error=$2 WHERE id=$1 AND attempts=$3",
        [
          job.id,
          e instanceof Error ? e.message.slice(0, 250) : 'Analysis failed',
          job.attempts,
          (e as { retryable?: boolean }).retryable === false,
        ],
      );
      if ((e as { stopWorker?: boolean }).stopWorker) throw e;
    }
  }
  return count;
}
export async function overdueSweep() {
  const db = await database();
  await db.query(`WITH overdue AS (
    SELECT p.id,p.organisation_id FROM plants p JOIN plant_species s ON s.id=p.species_id
    LEFT JOIN care_events c ON c.plant_id=p.id AND c.type='watered'
    GROUP BY p.id,s.watering_days
    HAVING coalesce(max(c.occurred_at),p.created_at)<now()-s.watering_days*interval '1 day'
  ), added AS (
    INSERT INTO alerts(id,organisation_id,plant_id,rule,severity,reason,recommended_action)
    SELECT gen_random_uuid(),organisation_id,id,'care-overdue','watch',
      'The soil moisture check cadence has passed.','Check soil moisture before watering.' FROM overdue
    ON CONFLICT(plant_id,rule) WHERE status<>'resolved' DO NOTHING RETURNING id
  ) INSERT INTO alert_status_events(id,alert_id,status) SELECT gen_random_uuid(),id,'open' FROM added`);
}
