'use client';
import { useApp, PageHeading } from '../app-shell';
import { useLocale } from '../locale';
import { ErrorMessage, TrendChart, Vitality } from '../ui';
import { useResource } from '@/lib/use-resource';
import type { analytics } from '@/server/services';
export function AnalyticsView() {
  const { workspace } = useApp(),
    { t, locale } = useLocale(),
    { data, error } = useResource<Awaited<ReturnType<typeof analytics>>>(
      `/api/workspaces/${workspace.id}/analytics`,
    );
  return (
    <>
      <PageHeading title="Analytics" description="The story is in the change." />
      <ErrorMessage message={error} />
      {data ? (
        <div className="analytics-grid">
          <section className="panel">
            <h2>Collection vitality</h2>
            <p>
              Weekly mean of the last known score per plant. Previous scores carry forward until a
              new observation or care snapshot. This is not a continuous sensor measurement.
            </p>
            <TrendChart
              height={220}
              points={data.trend.map((p) => ({
                score: p.score,
                label: new Intl.DateTimeFormat(locale, {
                  month: 'short',
                  day: 'numeric',
                  timeZone: workspace.timezone,
                }).format(new Date(p.week)),
              }))}
            />
          </section>
          <section className="panel dark">
            <h2>{t('Fleet vitality')}</h2>
            <Vitality score={data.summary.average} size={190} label distribution={data.summary} />
            <p>
              {data.summary.total} plants · {data.summary.baseline} building a baseline
            </p>
          </section>
          <section className="panel">
            <h2>Life across places</h2>
            {data.locations.map((l) => (
              <div className="location-bar" key={String(l.id)}>
                <span>{String(l.name)}</span>
                <meter min={0} max={data.summary.total || 1} value={Number(l.plants)} />
                <strong>{Number(l.plants)}</strong>
              </div>
            ))}
          </section>
          <section className="panel">
            <h2>Care signals</h2>
            <dl className="metric-list">
              <div>
                <dt>{t('Overdue care')}</dt>
                <dd>{data.summary.overdue}</dd>
              </div>
              <div>
                <dt>Serviced in 24 hours</dt>
                <dd>{data.summary.serviced}</dd>
              </div>
              <div>
                <dt>{t('Open alerts')}</dt>
                <dd>{data.summary.unresolved}</dd>
              </div>
            </dl>
            <p className="helper">
              Score estimates are explainable, versioned and linked to care or visual evidence.
              Review the plant record before changing care.
            </p>
          </section>
        </div>
      ) : (
        <div className="loading">{t('Loading…')}</div>
      )}
    </>
  );
}
