export interface PendingCare {
  id: string;
  scope: string;
  workspace: string;
  payload: Record<string, unknown>;
  state: 'pending' | 'blocked';
  error?: string;
}
const open = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('nabat-operations', 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore('care-outbox', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
async function transaction<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction('care-outbox', mode),
        request = action(tx.objectStore('care-outbox'));
      let value: T;
      request.onsuccess = () => {
        value = request.result;
      };
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => resolve(value);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
export const pendingCare = async (scope: string) =>
  ((await transaction('readonly', (s) => s.getAll())) as PendingCare[]).filter(
    (item) => item.scope === scope,
  );
export const savePendingCare = (item: PendingCare) => transaction('readwrite', (s) => s.put(item));
let syncing = false;
export async function syncPendingCare(scope: string) {
  if (syncing || !navigator.onLine) return;
  syncing = true;
  try {
    const items = await pendingCare(scope);
    if (!items.length) return;
    const identity = await fetch('/api/v1/operations/session').catch(() => null);
    if (!identity?.ok) return;
    const current = await identity.json();
    if (!scope.startsWith(current.actor.id + ':')) return;
    for (const item of items) {
      if (item.state !== 'pending') continue;
      let response: Response;
      try {
        response = await fetch('/api/v1/operations/' + item.workspace + '/care', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(item.payload),
        });
      } catch {
        return;
      }
      if (response.ok) await transaction('readwrite', (s) => s.delete(item.id));
      else if (response.status === 401 || response.status === 429 || response.status >= 500) return;
      else {
        const error = await response.json().catch(() => ({ error: 'Review this care event.' }));
        await savePendingCare({ ...item, state: 'blocked', error: error.error });
      }
    }
  } finally {
    syncing = false;
  }
}
