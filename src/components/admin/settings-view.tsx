'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Copy, Check, ArrowRight } from 'lucide-react';
import { useApp, PageHeading, SignOut } from '../app-shell';
import { useLocale } from '../locale';
import { ErrorMessage, Dialog } from '../ui';
import { useResource } from '@/lib/use-resource';
import { mutate, dateLabel } from '@/lib/client';
import { entitlements } from '@/domain/entitlements';
interface Transfer {
  id: string;
  plant_name: string;
  code: string;
  from_name: string;
  to_name: string;
  to_organisation_id: string;
  status: string;
}
interface Audit {
  id: string;
  action: string;
  created_at: string;
}
export function SettingsView() {
  const { workspace, actor, toast, analysisProvider } = useApp(),
    { t, locale } = useLocale(),
    router = useRouter(),
    admin = ['owner', 'admin'].includes(workspace.role);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [confirm, setConfirm] = useState<Transfer | null>(null);
  return (
    <>
      <PageHeading title="Settings" description="A home for the living record." />
      <div className="settings-grid">
        <section className="panel">
          <h2>{workspace.name}</h2>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              const f = new FormData(e.currentTarget);
              try {
                await mutate(
                  `/api/workspaces/${workspace.id}/settings`,
                  { name: f.get('name'), timezone: f.get('timezone') },
                  'PATCH',
                );
                toast('Workspace settings saved.');
                router.refresh();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              {t('Workspace name')}
              <input
                name="name"
                defaultValue={workspace.name}
                required
                disabled={!admin}
                maxLength={120}
              />
            </label>
            <label>
              {t('Timezone')}
              <input name="timezone" defaultValue={workspace.timezone} disabled={!admin} required />
            </label>
            <ErrorMessage message={error} />
            {admin && (
              <button className="button" disabled={busy}>
                {t('Save settings')}
              </button>
            )}
          </form>
          <label>
            Workspace ID
            <input value={workspace.id} readOnly />
          </label>
          <button
            className="text-link"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(workspace.id);
                toast('Workspace ID copied.');
              } catch {
                setError('Copy the workspace ID from the field.');
              }
            }}
          >
            <Copy size={16} />
            Copy for handover
          </button>
        </section>
        <section className="panel plan-panel">
          <h2>{workspace.plan.charAt(0).toUpperCase() + workspace.plan.slice(1)} workspace</h2>
          <p>V1 pilot access. No billing is connected.</p>
          <ul>
            <li>
              <Check size={16} />
              {entitlements[workspace.plan].plants.toLocaleString()} plants
            </li>
            <li>
              <Check size={16} />
              {entitlements[workspace.plan].team} team members
            </li>
            <li>
              <Check size={16} />
              Versioned health history
            </li>
            <li>
              <Check size={16} />
              NFC / QR identities
            </li>
          </ul>
          <h3>Analysis provider</h3>
          <p>
            {analysisProvider === 'development'
              ? 'Deterministic development simulation. No photo is sent to an external AI service.'
              : 'OpenAI multimodal vision. Uploaded images are sent for structured analysis; response storage is disabled.'}
          </p>
          <small>Configure provider credentials on the server. They never enter the browser.</small>
        </section>
        <section className="panel">
          <h2>Your account</h2>
          <label>
            Account ID
            <input value={actor.id} readOnly />
          </label>
          <p>
            {actor.name}
            <br />
            {actor.email}
          </p>
          <div className="account-actions">
            <button
              className="button secondary"
              onClick={async () => {
                await mutate('/api/locale', { locale: locale === 'en' ? 'ar' : 'en' });
                router.refresh();
              }}
            >
              {locale === 'en' ? 'العربية' : 'English'}
            </button>
            <SignOut />
          </div>
          <h3>{t('Privacy')}</h3>
          <p>
            Plant photos and operational records are private to their workspace. Public passports
            expose only the opted-in name, code and species. Edit visibility on each plant.
          </p>
          <p className="helper">
            PWA offline mode provides a reconnect screen. Care is saved only after the server
            confirms it.
          </p>
        </section>
        {admin && <TransferList onAccept={setConfirm} />}
        {admin && <AuditList />}
      </div>
      {confirm && (
        <Dialog title={t('Accept handover')} onClose={() => setConfirm(null)}>
          <p>
            <strong>{confirm.plant_name}</strong> will move from {confirm.from_name} to{' '}
            {confirm.to_name}. Its tag and lifetime history will continue. The former workspace
            loses access.
          </p>
          <button
            className="button full"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await mutate(`/api/transfers/${confirm.id}`, {});
                setConfirm(null);
                toast('Handover accepted. The plant history continues.');
                router.refresh();
                window.location.reload();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {t('Accept handover')}
            <ArrowRight size={18} />
          </button>
          <ErrorMessage message={error} />
        </Dialog>
      )}
    </>
  );
}
function TransferList({ onAccept }: { onAccept: (t: Transfer) => void }) {
  const { workspace } = useApp(),
    { t } = useLocale(),
    { data, error } = useResource<Transfer[]>(`/api/workspaces/${workspace.id}/transfers`);
  return (
    <section className="panel">
      <h2>Ownership handovers</h2>
      <ErrorMessage message={error} />
      {data?.length ? (
        data.map((transfer) => (
          <div className="transfer-row" key={transfer.id}>
            <strong>{transfer.plant_name}</strong>
            <p>
              {transfer.from_name} → {transfer.to_name}
            </p>
            <small>
              {transfer.code} · {transfer.status}
            </small>
            {transfer.status === 'pending' &&
              transfer.to_organisation_id === workspace.id &&
              workspace.role === 'owner' && (
                <button className="button small" onClick={() => onAccept(transfer)}>
                  {t('Accept handover')}
                </button>
              )}
          </div>
        ))
      ) : (
        <p>No handovers yet. Owners can request one from a plant record.</p>
      )}
    </section>
  );
}
function AuditList() {
  const { workspace } = useApp(),
    { locale } = useLocale(),
    { data, error } = useResource<Audit[]>(`/api/workspaces/${workspace.id}/audit`);
  return (
    <section className="panel audit-panel">
      <h2>Workspace audit</h2>
      <ErrorMessage message={error} />
      {data?.slice(0, 15).map((a) => (
        <div key={a.id}>
          <span>{a.action}</span>
          <small>{dateLabel(a.created_at, locale, workspace.timezone)}</small>
        </div>
      ))}
      {data?.length === 0 && <p>Workspace actions will appear here.</p>}
    </section>
  );
}
