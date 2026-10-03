import { createHash, randomUUID } from 'node:crypto';
import { database } from './db';
import { hashPassword } from './security';
import { signalNames, type VisionFeatures } from '@/domain/types';

export const fixtureId = (value: string) => {
  const h = createHash('sha256').update(`nabat-fixture:${value}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
export const DEMO_ORG = fixtureId('hotel');
export const DEMO_PASSWORD = 'NabatDemo2026!';
const species = [
  [
    'Peace Lily',
    'Spathiphyllum wallisii',
    'Bright indirect',
    18,
    30,
    7,
    'Check the upper soil before watering. Avoid direct sun.',
  ],
  [
    'Areca Palm',
    'Dypsis lutescens',
    'Bright indirect',
    18,
    28,
    7,
    'Keep soil lightly moist. Allow drainage; inspect tips regularly.',
  ],
  [
    'Monstera',
    'Monstera deliciosa',
    'Bright indirect',
    18,
    30,
    10,
    'Let the top 3 cm of soil dry. Support climbing stems.',
  ],
  [
    'Ficus Audrey',
    'Ficus benghalensis',
    'Bright indirect',
    18,
    30,
    10,
    'Avoid sudden moves. Let the upper soil dry between watering.',
  ],
  [
    'Snake Plant',
    'Dracaena trifasciata',
    'Indirect to low',
    16,
    32,
    21,
    'Let the soil dry fully. Keep the pot well drained.',
  ],
  [
    'Pothos',
    'Epipremnum aureum',
    'Bright indirect',
    18,
    30,
    10,
    'Water when the top layer is dry. Trim long vines as needed.',
  ],
  [
    'Olive Tree',
    'Olea europaea',
    'Direct sun',
    10,
    32,
    10,
    'Provide plenty of sunlight and excellent drainage.',
  ],
] as const;
const demoPlants = [
  ['Peace Lily', 0, 'Lobby', 42, -12, 'Watering overdue'],
  ['Areca Palm', 1, 'Restaurant', 68, -6, 'Inspect leaf tips'],
  ['Monstera No. 03', 2, 'Courtyard', 92, 4, null],
  ['Monstera No. 04', 2, 'Lobby', 86, 3, null],
  ['Snake Plant', 4, 'Guest rooms', 89, 2, null],
  ['Ficus Audrey', 3, 'Guest rooms', 61, -9, 'Yellowing increased'],
  ['Pothos', 5, 'Restaurant', 85, 3, null],
  ['Olive Tree', 6, 'Courtyard', 76, -2, 'Check light exposure'],
  ['Areca No. 09', 1, 'Lobby', 84, 1, null],
  ['Peace Lily No. 10', 0, 'Restaurant', 74, -1, 'Inspect soil moisture'],
  ['Ficus No. 11', 3, 'Courtyard', 88, 2, null],
  ['Monstera No. 12', 2, 'Guest rooms', 91, 4, null],
] as const;
export async function seed() {
  const db = await database();
  await db.transaction(async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(1742027)');
    if ((await tx.query('SELECT id FROM organisations WHERE id=$1', [DEMO_ORG])).rows.length)
      return;
    const owner = fixtureId('owner'),
      caretaker = fixtureId('caretaker');
    const password = await hashPassword(DEMO_PASSWORD);
    await tx.query(
      'INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,$3,$4),($5,$6,$7,$4)',
      [
        owner,
        'owner@nabat.demo',
        'Maya Chen',
        password,
        caretaker,
        'care@nabat.demo',
        'Omar Hassan',
      ],
    );
    await tx.query(
      "INSERT INTO organisations(id,name,kind,plan) VALUES($1,'NABAT Demo Hotel','business','business')",
      [DEMO_ORG],
    );
    await tx.query(
      "INSERT INTO organisation_memberships(id,organisation_id,user_id,role) VALUES($1,$2,$3,'owner'),($4,$2,$5,'caretaker')",
      [fixtureId('owner-membership'), DEMO_ORG, owner, fixtureId('care-membership'), caretaker],
    );
    for (const name of ['Lobby', 'Restaurant', 'Courtyard', 'Guest rooms'])
      await tx.query('INSERT INTO locations(id,organisation_id,name) VALUES($1,$2,$3)', [
        fixtureId(name),
        DEMO_ORG,
        name,
      ]);
    for (let i = 0; i < species.length; i++) {
      const s = species[i];
      await tx.query(
        'INSERT INTO plant_species(id,common_name,scientific_name,light,temperature_min,temperature_max,watering_days,guidance) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING',
        [fixtureId(`species-${i}`), ...s],
      );
    }
    const now = new Date();
    for (let i = 0; i < demoPlants.length; i++) {
      const [name, sp, loc, score, delta, reason] = demoPlants[i],
        id = fixtureId(`plant-${i}`);
      const image =
        sp === 2
          ? '/images/monstera.webp'
          : sp === 0
            ? '/images/peace-lily.webp'
            : sp === 1
              ? '/images/areca.webp'
              : sp === 3
                ? '/images/ficus.webp'
                : sp === 4
                  ? '/images/snake.webp'
                  : sp === 5
                    ? '/images/pothos.webp'
                    : '/images/olive.webp';
      await tx.query(
        "INSERT INTO plants(id,organisation_id,code,name,species_id,location_id,origin,acquired_at,demo_image,created_at) VALUES($1,$2,$3,$4,$5,$6,'NABAT nursery · synthetic fixture',$7::timestamptz::date,$8,$7::timestamptz)",
        [
          id,
          DEMO_ORG,
          `NAB-${String(i + 1).padStart(3, '0')}`,
          name,
          fixtureId(`species-${sp}`),
          fixtureId(loc),
          new Date(now.getTime() - 84 * 86400000).toISOString(),
          image,
        ],
      );
      const token = createHash('sha256').update(`demo-tag-${i}`).digest('base64url').slice(0, 32);
      await tx.query(
        'INSERT INTO plant_tags(id,organisation_id,plant_id,public_token) VALUES($1,$2,$3,$4)',
        [fixtureId(`tag-${i}`), DEMO_ORG, id, token],
      );
      await tx.query(
        'INSERT INTO plant_assignments(id,organisation_id,plant_id,user_id,assigned_by) VALUES($1,$2,$3,$4,$5)',
        [fixtureId(`assignment-${i}`), DEMO_ORG, id, caretaker, owner],
      );
      for (let k = 0; k < 6; k++) {
        const at = new Date(now.getTime() - (42 - k * 7) * 86400000),
          photoId = fixtureId(`photo-${i}-${k}`),
          analysisId = fixtureId(`analysis-${i}-${k}`);
        const value = Math.max(0.3, Math.min(0.95, (score - (delta * (5 - k)) / 5) / 100));
        const features: VisionFeatures = {
          ...(Object.fromEntries(
            signalNames.map((n) => [
              n,
              {
                value:
                  n === 'overall_visual_condition' || n === 'green_leaf_ratio'
                    ? value
                    : n === 'image_quality'
                      ? 0.9
                      : n === 'yellowing_estimate'
                        ? 1 - value
                        : 0.1,
                confidence: 0.7,
                evidence: 'Synthetic seeded observation, not a measurement.',
              },
            ]),
          ) as Record<
            (typeof signalNames)[number],
            { value: number; confidence: number; evidence: string }
          >),
          analysis_confidence: 0.7,
          evidence_summary: 'Synthetic demo history. No real plant was analysed.',
          comparable: true,
        };
        await tx.query(
          "INSERT INTO plant_photos(id,organisation_id,plant_id,actor_id,object_key,thumbnail_key,mime_type,bytes,width,height,source,captured_at,note,original_metadata) VALUES($1,$2,$3,$4,$5,$5,'image/webp',1024,1200,1200,'fixture',$6,'Weekly observation · synthetic fixture','{\"matchedView\":true}')",
          [photoId, DEMO_ORG, id, caretaker, image, at],
        );
        await tx.query(
          "INSERT INTO visual_analyses(id,organisation_id,plant_id,photo_id,provider,model,contract_version,prompt_version,features,created_at) VALUES($1,$2,$3,$4,'seed-fixture','synthetic/1.0','vision-signals/1.0','fixture/1.0',$5,$6)",
          [analysisId, DEMO_ORG, id, photoId, JSON.stringify(features), at],
        );
        await tx.query(
          "INSERT INTO health_score_snapshots(id,organisation_id,plant_id,analysis_id,score,delta,trend,confidence,composition,reasons,engine_version,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,.7,$8,$9,'seed-fixture/1.0',$10)",
          [
            fixtureId(`score-${i}-${k}`),
            DEMO_ORG,
            id,
            analysisId,
            Math.round(value * 100),
            k === 5 ? delta : 1,
            k < 2 ? 'baseline' : delta < 0 ? 'declining' : 'improving',
            JSON.stringify({ synthetic: value * 100 }),
            JSON.stringify([
              {
                text: reason || 'Visual signals are stable in the synthetic demo history.',
                action: reason
                  ? 'Inspect soil moisture and recent observations.'
                  : 'Continue care and capture a weekly observation.',
                sourceId: analysisId,
                kind: 'visual',
              },
            ]),
            at,
          ],
        );
      }
      const age = i === 0 ? 14 : i % 4;
      for (let k = 0; k < 4; k++)
        await tx.query(
          "INSERT INTO care_events(id,organisation_id,plant_id,actor_id,type,amount_ml,note,idempotency_key,occurred_at) VALUES($1,$2,$3,$4,'watered',350,'Synthetic care history',$5,$6)",
          [
            fixtureId(`care-${i}-${k}`),
            DEMO_ORG,
            id,
            caretaker,
            randomUUID(),
            new Date(now.getTime() - (age + k * 7) * 86400000),
          ],
        );
      if (reason) {
        const alertId = fixtureId(`alert-${i}`);
        await tx.query(
          "INSERT INTO alerts(id,organisation_id,plant_id,rule,severity,reason,recommended_action) VALUES($1,$2,$3,$4,$5,$6,'Check soil moisture and inspect this plant today.')",
          [
            alertId,
            DEMO_ORG,
            id,
            i === 0 ? 'care-overdue' : 'fixture-stress',
            score < 50 ? 'critical' : score < 70 ? 'attention' : 'watch',
            reason,
          ],
        );
        await tx.query("INSERT INTO alert_status_events(id,alert_id,status) VALUES($1,$2,'open')", [
          randomUUID(),
          alertId,
        ]);
      }
    }
    await tx.query(
      "INSERT INTO observations(id,organisation_id,plant_id,actor_id,source,photo_id,note,captured_at) SELECT id,organisation_id,plant_id,actor_id,'photo',id,note,captured_at FROM plant_photos WHERE organisation_id=$1 ON CONFLICT(id) DO NOTHING",
      [DEMO_ORG],
    );
  });
}
export async function ensureSpecies() {
  const db = await database();
  for (let i = 0; i < species.length; i++)
    await db.query(
      'INSERT INTO plant_species(id,common_name,scientific_name,light,temperature_min,temperature_max,watering_days,guidance) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING',
      [fixtureId(`species-${i}`), ...species[i]],
    );
}
