import { z } from 'zod';
import fs from 'node:fs/promises';
import { format } from 'prettier';
import {
  careInput,
  startSessionInput,
  sessionActionInput,
  taskInput,
  taskActionInput,
  bulkInput,
  alertInput,
  fleetInput,
  OPERATIONS_VERSION,
} from '../src/domain/operations/contracts';

const inputs = {
  Care: careInput,
  StartSession: startSessionInput,
  FinishSession: sessionActionInput,
  CreateTask: taskInput,
  UpdateTask: taskActionInput,
  BulkFleet: bulkInput,
  AlertTransition: alertInput,
  FleetQuery: fleetInput,
};
const schemas = Object.fromEntries(
  Object.entries(inputs).map(([name, schema]) => [
    name,
    z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }),
  ]),
);
const definitions: [string, string, string, string?][] = [
  ['get', '/session', 'Current authenticated identity'],
  ['post', '/session', 'Sign in with an existing NABAT account'],
  ['delete', '/session', 'Revoke current session'],
  ['post', '/workspaces', 'Create a workspace'],
  ['get', '/identity/{code}', 'Resolve a plant code within account memberships'],
  ['get', '/{org}/snapshot', 'Workspace operational snapshot'],
  ['get', '/{org}/fleet', 'Paginated, server sorted fleet'],
  ['post', '/{org}/care', 'Append captured care exactly once', 'Care'],
  ['get', '/{org}/care-receipts/{key}', 'Read actor-owned care receipt'],
  ['get', '/{org}/tasks', 'Today work in workspace timezone'],
  ['post', '/{org}/tasks', 'Schedule work', 'CreateTask'],
  ['post', '/{org}/tasks/{id}', 'Update work using expected revision', 'UpdateTask'],
  ['get', '/{org}/sessions', 'Maintenance history'],
  ['post', '/{org}/sessions', 'Start scoped maintenance', 'StartSession'],
  ['get', '/{org}/sessions/{id}', 'Maintenance detail'],
  ['post', '/{org}/sessions/{id}/finish', 'Complete or cancel maintenance', 'FinishSession'],
  ['post', '/{org}/bulk', 'Atomic assign or move', 'BulkFleet'],
  ['post', '/{org}/bulk-work', 'Atomic schedule, inspect or label'],
  ['post', '/{org}/alerts/{id}', 'Transition alert lifecycle', 'AlertTransition'],
  ['post', '/{org}/queue/reconcile', 'Materialise and reconcile due work'],
  ['get', '/{org}/plants/{id}', 'Plant history and observations'],
  ['post', '/{org}/plants', 'Create stable plant identity'],
  ['get', '/{org}/plants/{id}/score', 'Score components and provenance'],
  ['get', '/{org}/plants/{id}/compare', 'Comparison with provider/viewpoint boundary'],
  ['post', '/{org}/plants/{id}/lifecycle', 'Record verified lifecycle outcome'],
  ['get', '/{org}/views', 'Actor-owned saved views'],
  ['post', '/{org}/views', 'Save named view'],
  ['delete', '/{org}/views/{id}', 'Remove own view'],
  ['get', '/{org}/catalog', 'Species and structure'],
  ['get', '/{org}/locations', 'Full location aggregates'],
  ['post', '/{org}/locations', 'Create hierarchy location'],
  ['post', '/{org}/locations/{id}', 'Configure hierarchy and caretaker'],
  ['get', '/{org}/locations/{id}/floor-plan', 'Plan and normalised pins'],
  ['put', '/{org}/locations/{id}/floor-plan', 'Upload a private bounded plan'],
  ['get', '/{org}/floor-plans/{id}', 'Private plan bytes'],
  ['post', '/{org}/pins', 'Version-checked pin position'],
  ['delete', '/{org}/pins/{id}', 'Remove pin'],
  ['get', '/{org}/team', 'Memberships'],
  ['post', '/{org}/team', 'Admin-confirmed workspace membership'],
  ['get', '/{org}/team/operations', 'Full assignment and work aggregates'],
  ['get', '/{org}/analytics', 'Range and scope aggregates'],
  ['get', '/{org}/reports', 'Report data and metric definitions'],
  ['post', '/{org}/issues', 'Append operational issue'],
  ['get', '/{org}/imports', 'Owned import batches'],
  ['post', '/{org}/imports', 'Create bounded import batch'],
  ['get', '/{org}/imports/{id}', 'Review import items'],
  ['put', '/{org}/imports/detect', 'Decode own tenant QR identity'],
  ['post', '/{org}/import-items/{id}', 'Revision-checked mapping or observation link'],
  ['post', '/{org}/observations/sign', 'Reserve bounded private upload'],
  ['put', '/{org}/observations/{id}', 'Save observation before analysis'],
  ['get', '/{org}/upload-receipts/{id}', 'Recover actor-owned upload acknowledgement'],
  ['get', '/{org}/tags', 'Tag inventory and stable URLs'],
  ['get', '/{org}/tags/{id}/artwork', 'Vector artwork for chosen template'],
  ['get', '/{org}/tags/{id}/preview', 'Raster preview from identical artwork'],
  ['get', '/{org}/tags/sheet', 'A4 sheet, maximum 16 tags'],
  ['post', '/{org}/tags/{id}/lifecycle', 'Replace or retire stable identity'],
  ['post', '/{org}/tags/{id}/programming', 'Record client read-back or explicit simulation'],
  ['get', '/{org}/tags/programming-history', 'Programming history'],
];
const paths: Record<string, Record<string, unknown>> = {};
for (const [method, path, summary, input] of definitions) {
  const parameters = [...path.matchAll(/\{(\w+)\}/g)].map((m) => ({
    name: m[1],
    in: 'path',
    required: true,
    schema: {
      type: 'string',
      ...(m[1] === 'org' || m[1] === 'id' || m[1] === 'key' ? { format: 'uuid' } : {}),
    },
  }));
  (paths[path] ||= {})[method] = {
    summary,
    parameters,
    security: [{ bearerAuth: [] }, { sessionCookie: [] }],
    ...(input
      ? {
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { $ref: '#/components/schemas/' + input } } },
          },
        }
      : {}),
    responses: {
      '200': { description: 'Authorised result; private, no-store' },
      '400': { description: 'Validation failure' },
      '401': { description: 'Sign in again; pending work is retained' },
      '403': { description: 'Tenant or capability denied' },
      '409': { description: 'Refresh and review the changed revision or identity' },
      '429': { description: 'Bounded retry after rate limit' },
    },
  };
}
const document = {
  openapi: '3.1.0',
  info: {
    title: 'NABAT Operations',
    version: '1.1.0',
    description: `Contract ${OPERATIONS_VERSION}. Domain services remain authoritative. Request schemas are generated from runtime Zod schemas; omitted optional mutation schemas and response DTOs are described in docs/OPERATIONS.md. Binary upload limit 4 MiB. JSON input limit 64,000 bytes.`,
  },
  servers: [{ url: '/api/v1/operations' }],
  paths,
  components: {
    schemas,
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer' },
      sessionCookie: { type: 'apiKey', in: 'cookie', name: 'nabat_session' },
    },
  },
};
const output = await format(JSON.stringify(document), {
    parser: 'json',
    printWidth: 100,
    trailingComma: 'all',
  }),
  filename = 'docs/contracts/operations.openapi.json';
if (process.argv.includes('--check')) {
  if ((await fs.readFile(filename, 'utf8')) !== output)
    throw new Error('Operations contract drift: run npm run contract:operations');
} else {
  await fs.mkdir('docs/contracts', { recursive: true });
  await fs.writeFile(filename, output);
}
console.log(
  `Operations API contract: ${definitions.length} method/path definitions; ${Object.keys(schemas).length} generated schemas.`,
);
