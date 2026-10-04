import { database } from './db';
import { fixtureId, DEMO_ORG } from './seed';
import { storage } from './media';
import sharp from 'sharp';
export async function seedOperationalFixtures() {
  if (process.env.DATABASE_URL || process.env.NODE_ENV === 'production')
    throw new Error('Operational fixtures are local-only.');
  const db = await database(),
    owner = fixtureId('owner'),
    caretaker = fixtureId('caretaker');
  const locations = (
    await db.query<{ id: string; name: string }>(
      'SELECT id,name FROM locations WHERE organisation_id=$1',
      [DEMO_ORG],
    )
  ).rows;
  for (const location of locations) {
    const existing = (
      await db.query('SELECT id FROM location_floor_plans WHERE location_id=$1', [location.id])
    ).rows;
    if (existing.length) continue;
    const name = location.name.replace(/[<>&"]/g, '');
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="#f7f6ef"/><text x="48" y="58" font-size="28" fill="#153d32" font-family="Arial">NABAT Demo Hotel · ' +
      name +
      '</text><text x="48" y="91" font-size="16" fill="#64706b" font-family="Arial">Illustrative floor plan · synthetic fixture, not a measured property layout</text><g stroke="#153d32" fill="#edf2e4" stroke-width="4"><rect x="48" y="130" width="1104" height="590"/><path d="M410 130v590M790 130v590M48 430h1104"/></g><g font-family="Arial" font-size="24" fill="#153d32"><text x="85" y="185">East zone</text><text x="455" y="185">Central passage</text><text x="845" y="185">West zone</text><text x="85" y="490">Window area</text><text x="455" y="490">Care station</text><text x="845" y="490">Entrance</text></g></svg>';
    const id = fixtureId('operations-floor-' + location.id),
      key = DEMO_ORG + '/floor-plans/' + id + '.webp';
    await storage().put(key, await sharp(Buffer.from(svg)).webp().toBuffer(), 'image/webp');
    await db.transaction(async (tx) => {
      await tx.query(
        'INSERT INTO location_floor_plans(id,organisation_id,location_id,object_key,width,height,created_by) VALUES($1,$2,$3,$4,1200,800,$5) ON CONFLICT DO NOTHING',
        [id, DEMO_ORG, location.id, key, owner],
      );
      await tx.query(
        "UPDATE locations SET kind='zone',default_caretaker_id=$3,critical=name='Lobby' WHERE id=$1 AND organisation_id=$2",
        [location.id, DEMO_ORG, caretaker],
      );
      const plants = (
        await tx.query<{ id: string }>(
          'SELECT id FROM plants WHERE organisation_id=$1 AND location_id=$2 ORDER BY code',
          [DEMO_ORG, location.id],
        )
      ).rows;
      for (let n = 0; n < plants.length; n++)
        await tx.query(
          'INSERT INTO location_plant_pins(plant_id,organisation_id,location_id,x,y) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
          [
            plants[n].id,
            DEMO_ORG,
            location.id,
            0.12 + (n % 5) * 0.18,
            0.28 + Math.floor(n / 5) * 0.2,
          ],
        );
    });
  }
  for (let n = 0; n < 3; n++) {
    const id = fixtureId('operations-demo-session-' + n);
    if ((await db.query('SELECT id FROM maintenance_sessions WHERE id=$1', [id])).rows.length)
      continue;
    const location = locations[n % locations.length];
    await db.transaction(async (tx) => {
      await tx.query(
        "INSERT INTO maintenance_sessions(id,organisation_id,location_id,owner_id,status,started_at,ended_at,summary) VALUES($1,$2,$3,$4,'completed',now()-($5+1)*interval '1 day',now()-($5+1)*interval '1 day'+interval '35 minutes',$6)",
        [
          id,
          DEMO_ORG,
          location.id,
          caretaker,
          n,
          JSON.stringify({
            plants_visited: 6,
            watered: 4,
            fertilised: 1,
            inspected: 6,
            issues: 0,
            observations: 1,
            duration_minutes: 35,
            synthetic: true,
          }),
        ],
      );
      const plants = (
        await tx.query<{ id: string; name: string; code: string }>(
          'SELECT id,name,code FROM plants WHERE organisation_id=$1 AND location_id=$2 ORDER BY code LIMIT 6',
          [DEMO_ORG, location.id],
        )
      ).rows;
      for (const plant of plants)
        await tx.query(
          "INSERT INTO maintenance_session_plants(session_id,plant_id,plant_name,plant_code,visited_at) VALUES($1,$2,$3,$4,now()-interval '1 day')",
          [id, plant.id, plant.name, plant.code],
        );
      for (let index = 0; index < plants.length; index++) {
        const kinds = [
          'inspected',
          ...(index < 4 ? ['watered'] : []),
          ...(index === 0 ? ['fertilised', 'observation'] : []),
        ];
        for (const kind of kinds)
          await tx.query(
            "INSERT INTO maintenance_session_events(id,session_id,plant_id,type,actor_id,occurred_at,note) VALUES($1,$2,$3,$4,$5,now()-($6+1)*interval '1 day'+interval '15 minutes','Synthetic demo event')",
            [fixtureId(id + ':' + index + ':' + kind), id, plants[index].id, kind, caretaker, n],
          );
      }
    });
  }
}
