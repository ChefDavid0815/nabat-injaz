'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Bell, Check, ArrowRight } from 'lucide-react';
import { PageHeading, useApp } from '../app-shell';
import { useLocale } from '../locale';
import { Empty, ErrorMessage, Status } from '../ui';
import { useResource } from '@/lib/use-resource';
import { mutate, dateLabel } from '@/lib/client';
import type { Alert } from '@/domain/types';
export function AlertsView() {
  const { workspace, toast } = useApp(),
    { t, locale } = useLocale(),
    resource = useResource<Alert[]>(`/api/workspaces/${workspace.id}/alerts`);
  const [filter, setFilter] = useState('active'),
    [busy, setBusy] = useState<string | null>(null),
    [error, setError] = useState<string | null>(null);
  async function update(id: string, status: string) {
    setBusy(id);
    try {
      await mutate(`/api/alerts/${id}`, { status }, 'PATCH');
      toast(status === 'resolved' ? 'Alert resolved.' : 'Alert acknowledged.');
      resource.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  const visible = resource.data?.filter(
    (a) =>
      filter === 'all' || (filter === 'active' ? a.status !== 'resolved' : a.status === filter),
  );
  return (
    <>
      <PageHeading title="Alerts" description="A clear next step for every signal." />
      <div className="tabs">
        {[
          ['active', 'Needs care'],
          ['acknowledged', 'Acknowledged'],
          ['resolved', 'Resolved'],
          ['all', 'All alerts'],
        ].map(([key, label]) => (
          <button
            key={key}
            className={filter === key ? 'selected' : ''}
            onClick={() => setFilter(key)}
          >
            {t(label)}
          </button>
        ))}
      </div>
      <ErrorMessage message={error || resource.error} />
      {visible?.length ? (
        <section className="panel alert-list">
          {visible.map((a) => (
            <article className={`alert-item alert-${a.severity}`} key={a.id}>
              <span className="round-icon">
                <Bell size={21} />
              </span>
              <div className="alert-body">
                <div>
                  <Link href={`/app/plants/${a.plant_id}`}>
                    <h3>{a.name}</h3>
                  </Link>
                  <Status state={a.severity} />
                  <span className="muted">
                    {t(a.status.charAt(0).toUpperCase() + a.status.slice(1))}
                  </span>
                </div>
                <p>{a.reason}</p>
                <strong>{a.recommended_action}</strong>
                <small>
                  {a.code} · {a.location_name || 'Unplaced'} ·{' '}
                  {dateLabel(a.created_at, locale, workspace.timezone)}
                </small>
              </div>
              <div className="alert-actions">
                {a.status === 'open' && (
                  <button
                    className="button secondary small"
                    disabled={busy === a.id}
                    onClick={() => update(a.id, 'acknowledged')}
                  >
                    {t('Acknowledge')}
                  </button>
                )}
                {a.status !== 'resolved' && (
                  <button
                    className="button small"
                    disabled={busy === a.id}
                    onClick={() => update(a.id, 'resolved')}
                  >
                    <Check size={16} />
                    {t('Resolve')}
                  </button>
                )}
                <Link className="text-link" href={`/app/plants/${a.plant_id}`}>
                  Living record
                  <ArrowRight size={16} />
                </Link>
              </div>
            </article>
          ))}
        </section>
      ) : resource.data ? (
        <section className="panel">
          <Empty title={t('No alerts to act on')}>
            <p>Continue care and capture regular observations.</p>
          </Empty>
        </section>
      ) : (
        <div className="loading">{t('Loading…')}</div>
      )}
    </>
  );
}
