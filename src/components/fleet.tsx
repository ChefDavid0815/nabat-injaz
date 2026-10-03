'use client';
import Link from 'next/link';
import { useState } from 'react';
import {
  Plus,
  Search,
  LayoutGrid,
  List,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { useApp, PageHeading } from './app-shell';
import { useLocale } from './locale';
import { ErrorMessage, PlantImage, Vitality, Status, Empty } from './ui';
import { useResource } from '@/lib/use-resource';
import { dayAge } from '@/lib/client';
import type { Plant, Species, Location } from '@/domain/types';
export function Fleet({
  catalog,
  initialFilters = {},
}: {
  catalog: { species: Species[]; locations: Location[] };
  initialFilters?: { location?: string; state?: string; overdue?: boolean };
}) {
  const { workspace } = useApp(),
    { t } = useLocale();
  const [search, setSearch] = useState(''),
    [location, setLocation] = useState(initialFilters.location || ''),
    [state, setState] = useState(initialFilters.state || ''),
    [species, setSpecies] = useState(''),
    [assignee, setAssignee] = useState(''),
    [overdue, setOverdue] = useState(initialFilters.overdue || false),
    [alert, setAlert] = useState(''),
    [cards, setCards] = useState(false),
    [page, setPage] = useState(0);
  const query = new URLSearchParams({
    search,
    location,
    state,
    species,
    assignee,
    alert,
    overdue: String(overdue),
    page: String(page),
  });
  const resource = useResource<{ items: Plant[]; total: number; page: number; limit: number }>(
      `/api/workspaces/${workspace.id}/plants?${query}`,
    ),
    team = useResource<{ user_id: string; name: string }[]>(`/api/workspaces/${workspace.id}/team`);
  function filter(set: (v: string) => void, value: string) {
    set(value);
    setPage(0);
  }
  const data = resource.data;
  return (
    <>
      <PageHeading
        title="Your living collection"
        description="Every identity. Every place. Every change."
        action={
          workspace.role !== 'caretaker' && (
            <Link href="/app/plants/new" className="button">
              <Plus size={18} />
              {t('Add plant')}
            </Link>
          )
        }
      />
      <section className="panel fleet-panel">
        <div className="fleet-toolbar">
          <div className="search-field">
            <Search size={18} aria-hidden="true" />
            <input
              value={search}
              onChange={(e) => filter(setSearch, e.target.value)}
              aria-label={t('Search plants')}
              placeholder={t('Search plants')}
            />
          </div>
          <div className="view-toggle">
            <button
              className={!cards ? 'selected' : ''}
              aria-label={t('Table view')}
              aria-pressed={!cards}
              onClick={() => setCards(false)}
            >
              <List size={20} />
            </button>
            <button
              className={cards ? 'selected' : ''}
              aria-label={t('Card view')}
              aria-pressed={cards}
              onClick={() => setCards(true)}
            >
              <LayoutGrid size={20} />
            </button>
          </div>
        </div>
        <div className="filter-row">
          <select
            aria-label={t('Location')}
            value={location}
            onChange={(e) => filter(setLocation, e.target.value)}
          >
            <option value="">{t('All locations')}</option>
            {catalog.locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
          <select
            aria-label={t('Health')}
            value={state}
            onChange={(e) => filter(setState, e.target.value)}
          >
            <option value="">{t('All states')}</option>
            {['healthy', 'watch', 'attention', 'critical', 'baseline'].map((s) => (
              <option key={s} value={s}>
                {t(s.charAt(0).toUpperCase() + s.slice(1))}
              </option>
            ))}
          </select>
          <select
            aria-label={t('Species')}
            value={species}
            onChange={(e) => filter(setSpecies, e.target.value)}
          >
            <option value="">{t('All species')}</option>
            {catalog.species.map((s) => (
              <option key={s.id} value={s.id}>
                {s.common_name}
              </option>
            ))}
          </select>
          <select
            aria-label={t('Caretaker')}
            value={assignee}
            onChange={(e) => filter(setAssignee, e.target.value)}
          >
            <option value="">{t('All caretakers')}</option>
            {team.data?.map((u) => (
              <option key={u.user_id} value={u.user_id}>
                {u.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Alert type"
            value={alert}
            onChange={(e) => filter(setAlert, e.target.value)}
          >
            <option value="">{t('All alerts')}</option>
            <option value="care-overdue">Care overdue</option>
            <option value="rapid-decline">Rapid decline</option>
            <option value="yellowing">Yellowing</option>
            <option value="low-vitality">Low vitality</option>
          </select>
          <label className="checkbox-inline">
            <input
              type="checkbox"
              checked={overdue}
              onChange={(e) => {
                setOverdue(e.target.checked);
                setPage(0);
              }}
            />
            {t('Overdue care')}
          </label>
        </div>
        <ErrorMessage message={resource.error} />
        {!data && !resource.error ? (
          <div className="loading" role="status">
            {t('Loading…')}
          </div>
        ) : data?.items.length ? (
          cards ? (
            <div className="plant-card-grid">
              {data.items.map((p) => (
                <Link key={p.id} href={`/app/plants/${p.id}`} className="plant-card">
                  <PlantImage src={p.image} name={p.name} />
                  <div>
                    <span>
                      <h3>{p.name}</h3>
                      <small>
                        {p.code} · {p.location_name || 'Unplaced'}
                      </small>
                    </span>
                    <Vitality score={p.score} size={60} />
                  </div>
                  <Status score={p.score} />
                  {p.alert_reason && <p>{p.alert_reason}</p>}
                </Link>
              ))}
            </div>
          ) : (
            <div className="fleet-table">
              <div className="fleet-labels">
                <span>{t('Plant')}</span>
                <span>{t('Location')}</span>
                <span>{t('Health')}</span>
                <span>Trend</span>
                <span>{t('Last care')}</span>
                <span>{t('Caretaker')}</span>
                <span>{t('Alerts')}</span>
              </div>
              {data.items.map((p) => (
                <Link className="fleet-row" key={p.id} href={`/app/plants/${p.id}`}>
                  <div className="plant-identity">
                    <PlantImage src={p.image} name={p.name} />
                    <span>
                      <strong>{p.name}</strong>
                      <small>
                        {p.code} · {p.species_name}
                      </small>
                    </span>
                  </div>
                  <span className="fleet-location">{p.location_name || 'Unplaced'}</span>
                  <div className="fleet-health">
                    <strong>{p.score ?? '—'}</strong>
                    <Status score={p.score} />
                  </div>
                  <span className={`trend-${p.trend} fleet-trend`}>
                    {p.delta === null ? 'Baseline' : `${p.delta > 0 ? '+' : ''}${p.delta}`}
                  </span>
                  <span className="fleet-lastcare">
                    {p.last_serviced ? `${dayAge(p.last_serviced)}d ago` : 'No care yet'}
                  </span>
                  <span className="fleet-assignee">{p.assignee_name || 'Unassigned'}</span>
                  <span className="fleet-alert">{p.alert_reason || '—'}</span>
                  <ArrowRight size={16} className="row-arrow" aria-hidden="true" />
                </Link>
              ))}
            </div>
          )
        ) : (
          <Empty title={t('No plants found')}>
            <p>Try another filter or give a new plant an identity.</p>
          </Empty>
        )}
        {data && (
          <footer className="pagination">
            <span>
              {data.total ? Math.min(page * data.limit + 1, data.total) : 0}–
              {Math.min((page + 1) * data.limit, data.total)} of {data.total} plants
            </span>
            <div>
              <button
                className="icon-button"
                aria-label={t('Previous')}
                disabled={!page}
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronLeft size={20} />
              </button>
              <button
                className="icon-button"
                aria-label={t('Next')}
                disabled={(page + 1) * data.limit >= data.total}
                onClick={() => setPage((p) => p + 1)}
              >
                <ChevronRight size={20} />
              </button>
            </div>
          </footer>
        )}
      </section>
    </>
  );
}
