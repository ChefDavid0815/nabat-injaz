'use client';
import Link from 'next/link';
import { useState } from 'react';
import { MapPin, Plus, ArrowRight } from 'lucide-react';
import { useApp, PageHeading } from '../app-shell';
import { useLocale } from '../locale';
import { Dialog, ErrorMessage, Empty } from '../ui';
import { useResource } from '@/lib/use-resource';
import { mutate } from '@/lib/client';
interface Place {
  id: string;
  name: string;
  parent_id: string | null;
  plants: number;
}
export function LocationsView() {
  const { workspace, toast } = useApp(),
    { t } = useLocale(),
    resource = useResource<{ locations: Place[] }>(`/api/workspaces/${workspace.id}/analytics`),
    [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const places = resource.data?.locations || [];
  function branch(parent: string | null, depth = 0): React.ReactNode {
    return places
      .filter((p) => p.parent_id === parent)
      .map((p) => (
        <div key={p.id} style={{ marginInlineStart: depth ? 24 : 0 }}>
          <Link className="location-row" href={`/app/plants?location=${p.id}`}>
            <MapPin size={23} />
            <span>
              <h3>{p.name}</h3>
              <small>{p.plants} plants</small>
            </span>
            <ArrowRight size={18} />
          </Link>
          {depth < 20 && branch(p.id, depth + 1)}
        </div>
      ));
  }
  return (
    <>
      <PageHeading
        title="Locations"
        description="Every plant belongs somewhere."
        action={
          workspace.role !== 'caretaker' && (
            <button className="button" onClick={() => setOpen(true)}>
              <Plus size={18} />
              {t('Create location')}
            </button>
          )
        }
      />
      <section className="panel locations-panel">
        <h2>{workspace.name}</h2>
        <ErrorMessage message={resource.error} />
        {places.length ? (
          branch(null)
        ) : (
          <Empty title="Make room for your first plant">
            <p>Start with a lobby, classroom or growing bench.</p>
          </Empty>
        )}
      </section>
      {open && (
        <Dialog title={t('Create location')} onClose={() => setOpen(false)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              setBusy(true);
              try {
                await mutate(`/api/workspaces/${workspace.id}/locations`, {
                  name: form.get('name'),
                  parentId: form.get('parent') || null,
                });
                setOpen(false);
                resource.reload();
                toast('Location created.');
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              {t('Name')}
              <input name="name" required maxLength={120} />
            </label>
            <label>
              {t('Parent location')}
              <select name="parent">
                <option value="">{t('No parent')}</option>
                {places.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <ErrorMessage message={error} />
            <button className="button full" disabled={busy}>
              {t('Create location')}
            </button>
          </form>
        </Dialog>
      )}
    </>
  );
}
