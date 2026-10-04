import { savePendingCare, syncPendingCare, pendingCare } from './operations-outbox';
export async function saveFieldCare(
  actor: string,
  workspace: string,
  plant: string,
  input: { type: string; idempotencyKey: string; note?: unknown; amountMl?: number | null },
) {
  const scope = actor + ':' + workspace,
    payload = {
      plantId: plant,
      type: input.type,
      idempotencyKey: input.idempotencyKey,
      expectedActorId: actor,
      occurredAt: new Date().toISOString(),
      note: String(input.note || ''),
      ...(input.amountMl != null ? { amountMl: input.amountMl } : {}),
    };
  await savePendingCare({ id: input.idempotencyKey, scope, workspace, payload, state: 'pending' });
  await syncPendingCare(scope);
  const pending = (await pendingCare(scope)).find((p) => p.id === input.idempotencyKey);
  if (pending) {
    if (pending.state === 'blocked')
      throw new Error(pending.error || 'Care needs review. The local record was preserved.');
    return { id: 'pending:' + input.idempotencyKey, pending: true };
  }
  const response = await fetch(
    '/api/v1/operations/' + workspace + '/care-receipts/' + input.idempotencyKey,
  );
  if (!response.ok) throw new Error('Care was submitted. Refresh the record to confirm.');
  const result = await response.json();
  if (!result?.id) throw new Error('Care receipt is not available yet. Refresh to confirm.');
  return { id: result.id as string, pending: false };
}
