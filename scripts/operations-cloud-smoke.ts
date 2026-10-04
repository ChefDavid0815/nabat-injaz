import { randomUUID, randomBytes } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';
import { seal } from './windows-seal';
const base = 'https://nabat-injaz.vercel.app';
const email = 'operations-release-' + Date.now() + '@verification.nabat',
  password = randomBytes(24).toString('base64url') + '!aA2';
let token = '';
async function call(route: string, data?: unknown, authenticated = true) {
  const response = await fetch(base + route, {
    method: data === undefined ? 'GET' : 'POST',
    headers: {
      ...(data === undefined ? {} : { 'Content-Type': 'application/json', Origin: base }),
      ...(authenticated ? { Authorization: 'Bearer ' + token } : {}),
    },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    redirect: 'manual',
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok)
    throw new Error(
      `Release check ${route.split('/').slice(0, 4).join('/')} returned ${response.status}.`,
    );
  return response.json();
}
await call('/api/auth/register', { name: 'Operations release validation', email, password }, false);
const account = await call('/api/v1/operations/session', { email, password }, false);
token = account.token;
const workspace = await call('/api/v1/operations/workspaces', {
  name: 'Operations release verification',
  kind: 'business',
  firstLocation: 'Verification area',
});
const org = workspace.id,
  root = '/api/v1/operations/' + org;
const catalog = await call(root + '/catalog');
const location = await call(root + '/locations', { name: 'Verification area' });
const plant = await call(root + '/plants', {
  name: 'Release verification plant',
  speciesId: catalog.species[0].id,
  locationId: location.id,
  publicPassport: true,
});
const task = await call(root + '/tasks', {
  plantId: plant.id,
  kind: 'inspected',
  title: 'Release verification inspection',
  dueAt: new Date().toISOString(),
  idempotencyKey: randomUUID(),
  assigneeId: account.actor.id,
});
const session = await call(root + '/sessions', {
  plantIds: [plant.id],
  idempotencyKey: randomUUID(),
});
const input = {
  plantId: plant.id,
  type: 'inspected',
  occurredAt: new Date().toISOString(),
  expectedActorId: account.actor.id,
  taskId: task.id,
  sessionId: session.id,
  note: 'Synthetic release verification event',
  idempotencyKey: randomUUID(),
};
const first = await call(root + '/care', input),
  replay = await call(root + '/care', input);
if (first.id !== replay.id) throw new Error('Care was duplicated.');
const finished = await call(root + '/sessions/' + session.id + '/finish', {
  revision: 0,
  action: 'complete',
  idempotencyKey: randomUUID(),
});
if (finished.summary.plants_visited !== 1) throw new Error('Maintenance progress did not persist.');
const snapshot = await call(root + '/snapshot');
if (
  snapshot.contractVersion !== 'operations/1.1' ||
  snapshot.tasks.find((t: { id: string }) => t.id === task.id)?.status !== 'completed'
)
  throw new Error('Shared native snapshot did not persist work.');
const tags = await call(root + '/tags'),
  tag = tags.find((t: { plant_id: string }) => t.plant_id === plant.id);
await call(root + '/tags/' + tag.id + '/programming', {
  reader: 'Cloud software simulation',
  uid: '53494D',
  url: tag.resolver_url,
  verification: 'simulated',
  idempotencyKey: randomUUID(),
});
const passport = await fetch(tag.resolver_url, { redirect: 'manual' });
if (passport.status !== 200) throw new Error('Public resolver did not load.');
const anonymous = await fetch(base + root + '/snapshot');
if (anonymous.status !== 401) throw new Error('Private workspace allowed an anonymous request.');
await mkdir('data', { recursive: true });
await writeFile(
  'data/operations-cloud-validation.dpapi',
  seal(Buffer.from(JSON.stringify({ base, email, password, organisation: org, plant: plant.id }))),
);
const evidence = {
  checkedAt: new Date().toISOString(),
  origin: base,
  contract: snapshot.contractVersion,
  sharedAuthenticationService: true,
  nativeBearer: true,
  careReplayedExactlyOnce: true,
  maintenanceVisited: 1,
  taskCompleted: true,
  simulatedProgrammingAudit: true,
  publicResolver: passport.status,
  privateAnonymousDenied: anonymous.status,
  observationsUploaded: false,
  modelCalls: 0,
  physicalNfc: false,
  validationOrganisation: org,
};
await mkdir('docs/qa/operations', { recursive: true });
await writeFile('docs/qa/operations/cloud-smoke.json', JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify(evidence));
