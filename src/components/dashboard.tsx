'use client';
import Link from 'next/link';
import {
  Plus,
  Search,
  Leaf,
  TriangleAlert,
  CircleAlert,
  ArrowRight,
  Droplets,
  Camera,
  Bell,
} from 'lucide-react';
import { PageHeading, useApp } from './app-shell';
import { Vitality, TrendChart, Status, PlantImage, Empty } from './ui';
import { useLocale } from './locale';
import type { analytics } from '@/server/services';
import type { Plant } from '@/domain/types';
type Analytics = Awaited<ReturnType<typeof analytics>>;
export function Dashboard({ data, plants }: { data: Analytics; plants: Plant[] }) {
  const { actor, workspace, openSearch } = useApp(),
    { t, locale } = useLocale(),
    s = data.summary;
  const priority = plants.filter((p) => p.active_alerts > 0).slice(0, 3),
    collection = [...plants].filter((p) => !p.active_alerts).slice(0, 4);
  const number = (n: number) => new Intl.NumberFormat(locale).format(n);
  return (
    <>
      <PageHeading
        title={
          locale === 'ar'
            ? `صباح الخير، ${actor.name.split(' ')[0]}.`
            : `Good morning, ${actor.name.split(' ')[0]}.`
        }
        description="A little attention. A lot of life."
        action={
          <>
            <button className="icon-button" aria-label={t('Search plants')} onClick={openSearch}>
              <Search size={21} />
            </button>
            {workspace.role !== 'caretaker' && (
              <Link className="button" href="/app/plants/new">
                <Plus size={18} aria-hidden="true" />
                {t('Add plant')}
              </Link>
            )}
          </>
        }
      />
      <div className="stats-grid">
        {[
          ['Total plants', s.total, Leaf],
          ['Healthy', s.healthy, Leaf],
          ['Need attention', s.watch + s.attention, TriangleAlert],
          ['Critical', s.critical, CircleAlert],
        ].map(([label, n, Icon], i) => {
          const I = Icon as typeof Leaf;
          return (
            <Link
              key={String(label)}
              href={`/app/plants${i === 1 ? '?state=healthy' : i === 2 ? '?overdue=true' : i === 3 ? '?state=critical' : ''}`}
              className={`stat stat-${i}`}
            >
              <I size={29} strokeWidth={1.6} aria-hidden="true" />
              <span>
                <small>{t(String(label))}</small>
                <strong>{number(Number(n))}</strong>
              </span>
            </Link>
          );
        })}
      </div>
      <div className="dashboard-grid">
        <section className="panel queue-panel">
          <div className="panel-heading">
            <div>
              <h2>{t('Care starts here.')}</h2>
              <p>{t('The plants that need you today.')}</p>
            </div>
            <Link href="/app/plants" className="text-link">
              {t('View all plants')}
              <ArrowRight size={16} />
            </Link>
          </div>
          {priority.length ? (
            <div className="queue-table">
              <div className="queue-labels">
                <span>{t('Plant')}</span>
                <span>{t('Location')}</span>
                <span>{t('Severity')}</span>
                <span>Score</span>
                <span>{t('Reason')}</span>
              </div>
              {priority.map((p) => (
                <Link key={p.id} href={`/app/plants/${p.id}`} className="queue-row">
                  <div className="plant-identity">
                    <PlantImage src={p.image} name={p.name} />
                    <span>
                      <strong>{p.name}</strong>
                      <small>{p.code}</small>
                    </span>
                  </div>
                  <span className="queue-location">{p.location_name || 'Unplaced'}</span>
                  <Status state={p.alert_severity || undefined} />
                  <strong className="tabular queue-score">{p.score ?? '—'}</strong>
                  <span className="queue-reason">{p.alert_reason}</span>
                  <ArrowRight size={17} className="row-arrow" aria-hidden="true" />
                </Link>
              ))}
            </div>
          ) : (
            <Empty title={t('No alerts to act on')}>
              <p>Your living collection is ready for its next observation.</p>
            </Empty>
          )}
          <div className="queue-summary">
            <span>
              {s.overdue} {t('Overdue care').toLowerCase()}
            </span>
            <span>{s.serviced} recently serviced</span>
            <span>{s.baseline} building a baseline</span>
          </div>
        </section>
        <section className="panel dark vitality-panel">
          <h2>{t('Fleet vitality')}</h2>
          <p>{t('Across your living collection.')}</p>
          <div className="fleet-vitality">
            <Vitality
              score={s.average}
              size={192}
              label
              distribution={{
                healthy: s.healthy,
                watch: s.watch,
                attention: s.attention,
                critical: s.critical,
                baseline: s.baseline,
              }}
            />
            <div className="distribution">
              {(['healthy', 'watch', 'attention', 'critical'] as const).map((state) => (
                <div key={state}>
                  <span className={`dot dot-${state}`} />
                  <span>{t(state.charAt(0).toUpperCase() + state.slice(1))}</span>
                  <strong>{s[state]}</strong>
                  <small>{s.total ? Math.round((s[state] / s.total) * 100) : 0}%</small>
                </div>
              ))}
            </div>
          </div>
        </section>
        <section className="panel trend-panel">
          <div className="panel-heading">
            <div>
              <h2>{t('Small care. Lasting change.')}</h2>
              <p>Collection vitality over the past 8 weeks.</p>
            </div>
            <Link className="text-link" href="/app/analytics">
              {t('View analytics')}
              <ArrowRight size={16} />
            </Link>
          </div>
          <TrendChart
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
        <section className="panel rhythm-panel">
          <h2>{t('Today’s rhythm')}</h2>
          <p>Small actions keep a living history.</p>
          {[
            ['Watered', data.activity.watered, Droplets],
            ['Observations', data.activity.observations, Camera],
            ['Open alerts', s.unresolved, Bell],
          ].map(([label, n, Icon]) => {
            const I = Icon as typeof Leaf;
            return (
              <div className="rhythm-row" key={String(label)}>
                <span className="round-icon">
                  <I size={22} aria-hidden="true" />
                </span>
                <span>{t(String(label))}</span>
                <strong>{number(Number(n))}</strong>
              </div>
            );
          })}
        </section>
        <section className="panel collection-panel">
          <div className="panel-heading">
            <div>
              <h2>{t('Your living collection')}</h2>
              <p>A closer look at the plants in your care.</p>
            </div>
            <Link className="text-link" href="/app/plants">
              {t('View all plants')}
              <ArrowRight size={16} />
            </Link>
          </div>
          <div className="collection-strip">
            {collection.map((p) => (
              <Link className="collection-item" key={p.id} href={`/app/plants/${p.id}`}>
                <PlantImage src={p.image} name={p.name} />
                <span>
                  <strong>{p.name}</strong>
                  <em>{p.scientific_name}</em>
                  <small>{p.location_name || 'Unplaced'}</small>
                </span>
                <Vitality score={p.score} size={49} />
              </Link>
            ))}
          </div>
          {!s.total && (
            <Link className="button" href="/app/plants/new">
              {t('Add plant')}
            </Link>
          )}
        </section>
      </div>
    </>
  );
}
