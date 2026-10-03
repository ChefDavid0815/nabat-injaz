'use client';
import { useState } from 'react';
import { Plus, ShieldCheck } from 'lucide-react';
import { useApp, PageHeading } from '../app-shell';
import { useLocale } from '../locale';
import { Dialog, ErrorMessage } from '../ui';
import { useResource } from '@/lib/use-resource';
import { mutate } from '@/lib/client';
interface Member {
  id: string;
  name: string;
  email: string;
  role: string;
}
export function TeamView() {
  const { workspace, toast } = useApp(),
    { t } = useLocale(),
    resource = useResource<Member[]>(`/api/workspaces/${workspace.id}/team`),
    [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  return (
    <>
      <PageHeading
        title="Team"
        description="Different hands. One continuous history."
        action={
          ['owner', 'admin'].includes(workspace.role) && (
            <button className="button" onClick={() => setOpen(true)}>
              <Plus size={18} />
              {t('Add teammate')}
            </button>
          )
        }
      />
      <section className="panel team-panel">
        <ErrorMessage message={resource.error} />
        {resource.data?.map((m) => (
          <div className="team-row" key={m.id}>
            <span className="avatar">
              {m.name
                .split(' ')
                .map((n) => n[0])
                .slice(0, 2)
                .join('')}
            </span>
            <span>
              <h3>{m.name}</h3>
              <p>{m.email}</p>
            </span>
            <span className="role-label">
              <ShieldCheck size={16} />
              {t(m.role.charAt(0).toUpperCase() + m.role.slice(1))}
            </span>
          </div>
        ))}
      </section>
      <section className="role-explainer">
        <h2>Clear responsibilities.</h2>
        <div>
          {[
            ['Owner', 'Workspace settings, team, plants and ownership handover.'],
            ['Admin', 'Workspace settings, team, plants and tag management.'],
            ['Manager', 'Plants, tags, locations and caretaker assignment.'],
            ['Caretaker', 'View plants, record care, add observations and act on alerts.'],
          ].map(([role, text]) => (
            <p key={role}>
              <strong>{t(role)}</strong>
              <span>{text}</span>
            </p>
          ))}
        </div>
      </section>
      {open && (
        <Dialog title={t('Add teammate')} onClose={() => setOpen(false)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              setBusy(true);
              try {
                await mutate(`/api/workspaces/${workspace.id}/team`, {
                  email: f.get('email'),
                  userId: f.get('userId'),
                  role: f.get('role'),
                });
                setOpen(false);
                resource.reload();
                toast('Teammate added.');
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <p>
              Confirm the teammate’s account ID from their Settings through your usual contact
              channel, then enter it with their email. Access starts immediately.
            </p>
            <label>
              {t('Email')}
              <input name="email" type="email" required />
            </label>
            <label>
              Teammate account ID
              <input name="userId" required />
            </label>
            <label>
              {t('Role')}
              <select name="role">
                <option value="caretaker">{t('Caretaker')}</option>
                <option value="manager">{t('Manager')}</option>
                <option value="admin">{t('Admin')}</option>
              </select>
            </label>
            <ErrorMessage message={error} />
            <button className="button full" disabled={busy}>
              {t('Add teammate')}
            </button>
          </form>
        </Dialog>
      )}
    </>
  );
}
