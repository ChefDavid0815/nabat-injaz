import { database } from './db';
import { DEMO_ORG, fixtureId } from './seed';
export async function seedOperationsDemo() {
  if (process.env.DATABASE_URL || process.env.NODE_ENV === 'production')
    throw new Error('Operations demo expansion is local-only.');
  const db = await database();
  await db.transaction(async (tx) => {
    const pool = fixtureId('Pool Area');
    await tx.query(
      "INSERT INTO locations(id,organisation_id,name) VALUES($1,$2,'Pool Area') ON CONFLICT DO NOTHING",
      [pool, DEMO_ORG],
    );
    for (let n = 12; n < 48; n++) {
      const id = fixtureId(`operations-plant-${n}`),
        source = fixtureId(`plant-${n % 12}`);
      if ((await tx.query('SELECT id FROM plants WHERE id=$1', [id])).rows.length) continue;
      await tx.query(
        `INSERT INTO plants(id,organisation_id,code,name,species_id,location_id,origin,demo_image,created_at)
        SELECT $1,organisation_id,$2,name||' '||$3,species_id,CASE WHEN $4 THEN $5::uuid ELSE location_id END,'Operations synthetic fixture',demo_image,created_at FROM plants WHERE id=$6`,
        [id, `NAB-${String(n + 1).padStart(3, '0')}`, n + 1, n % 3 === 0, pool, source],
      );
      const histories = (
        await tx.query<{ id: string }>(
          'SELECT id FROM health_score_snapshots WHERE plant_id=$1 ORDER BY created_at',
          [source],
        )
      ).rows;
      for (let k = 0; k < histories.length; k++) {
        const photo = fixtureId(`operations-photo-${n}-${k}`),
          analysis = fixtureId(`operations-analysis-${n}-${k}`);
        await tx.query(
          `INSERT INTO plant_photos(id,organisation_id,plant_id,actor_id,object_key,thumbnail_key,mime_type,bytes,width,height,source,captured_at,note,original_metadata)
          SELECT $1,ph.organisation_id,$2,ph.actor_id,ph.object_key,ph.thumbnail_key,ph.mime_type,ph.bytes,ph.width,ph.height,'fixture',ph.captured_at,'Synthetic sample · repeated fixture photograph',ph.original_metadata FROM health_score_snapshots h JOIN visual_analyses a ON a.id=h.analysis_id JOIN plant_photos ph ON ph.id=a.photo_id WHERE h.id=$3`,
          [photo, id, histories[k].id],
        );
        await tx.query(
          `INSERT INTO visual_analyses(id,organisation_id,plant_id,photo_id,provider,model,contract_version,prompt_version,features,created_at)
          SELECT $1,a.organisation_id,$2,$3,a.provider,a.model,a.contract_version,a.prompt_version,a.features,a.created_at FROM health_score_snapshots h JOIN visual_analyses a ON a.id=h.analysis_id WHERE h.id=$4`,
          [analysis, id, photo, histories[k].id],
        );
        await tx.query(
          `INSERT INTO health_score_snapshots(id,organisation_id,plant_id,analysis_id,score,delta,trend,confidence,composition,reasons,engine_version,created_at)
          SELECT $1,organisation_id,$2,$3,score,delta,trend,confidence,composition,reasons,'seed-fixture/1.1',created_at FROM health_score_snapshots WHERE id=$4`,
          [fixtureId(`operations-score-${n}-${k}`), id, analysis, histories[k].id],
        );
      }
      await tx.query(
        `INSERT INTO plant_assignments(id,organisation_id,plant_id,user_id,assigned_by) SELECT $1,organisation_id,$2,user_id,assigned_by FROM plant_assignments WHERE plant_id=$3 AND ended_at IS NULL`,
        [fixtureId(`operations-assignment-${n}`), id, source],
      );
      await tx.query(
        `INSERT INTO care_events(id,organisation_id,plant_id,actor_id,type,note,idempotency_key,occurred_at) SELECT $1,organisation_id,$2,actor_id,'watered','Synthetic operation history',$3,max(occurred_at) FROM care_events WHERE plant_id=$4 AND type='watered' GROUP BY organisation_id,actor_id`,
        [fixtureId(`operations-care-${n}`), id, fixtureId(`operations-care-key-${n}`), source],
      );
      await tx.query(
        `INSERT INTO plant_tags(id,organisation_id,plant_id,public_token) VALUES($1,$2,$3,$4)`,
        [
          fixtureId(`operations-tag-${n}`),
          DEMO_ORG,
          id,
          fixtureId(`operations-tag-token-${n}`).replaceAll('-', ''),
        ],
      );
    }
    await tx.query(
      `INSERT INTO observations(id,organisation_id,plant_id,actor_id,source,photo_id,note,captured_at) SELECT id,organisation_id,plant_id,actor_id,'photo',id,note,captured_at FROM plant_photos WHERE organisation_id=$1 ON CONFLICT(id) DO NOTHING`,
      [DEMO_ORG],
    );
  });
}
