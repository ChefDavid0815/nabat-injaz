'use client';
import Link from 'next/link';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Droplets,
  Leaf,
  Sprout,
  MoveHorizontal,
  Search,
  Plus,
  MapPin,
  Tag,
  ArrowLeft,
  Sun,
  Thermometer,
  Camera,
  Check,
  Settings,
  Users,
  ArrowRight,
  LoaderCircle,
} from 'lucide-react';
import { useApp } from './app-shell';
import { useLocale } from './locale';
import { PlantImage, Vitality, Status, TrendChart, Dialog, ErrorMessage } from './ui';
import { PhotoCapture } from './photo-capture';
import { api, mutate, dateLabel, dayAge } from '@/lib/client';
import { saveFieldCare } from '@/lib/field-care';
import { syncPendingCare } from '@/lib/operations-outbox';
import type { plantDetails } from '@/server/services';
import type { Location, CareType, TimelineItem } from '@/domain/types';
type Detail = Awaited<ReturnType<typeof plantDetails>>;
const actions = [
  ['watered', 'Watered', Droplets],
  ['fertilised', 'Fertilised', Leaf],
  ['repotted', 'Repotted', Sprout],
  ['moved', 'Moved', MoveHorizontal],
  ['inspected', 'Inspected', Search],
] as const;
export function PlantProfile({
  initial,
  locations,
  team,
  nfc = false,
}: {
  initial: Detail;
  locations: Location[];
  team: { user_id: string; name: string }[];
  nfc?: boolean;
}) {
  const { actor, workspace, analysisProvider, toast } = useApp(),
    { t, locale } = useLocale(),
    router = useRouter();
  const [data, setData] = useState(initial),
    [care, setCare] = useState<CareType | null>(null),
    [photo, setPhoto] = useState(false),
    [photoCare, setPhotoCare] = useState<string | undefined>(),
    [edit, setEdit] = useState(false),
    [handover, setHandover] = useState(false),
    [assignment, setAssignment] = useState(false),
    [pending, setPending] = useState(false),
    [loadingHistory, setLoadingHistory] = useState(false),
    [optimistic, setOptimistic] = useState<TimelineItem | null>(null),
    [lastCare, setLastCare] = useState<string | null>(null),
    [error, setError] = useState<string | null>(null);
  const p = data.plant;
  useEffect(() => {
    let active = true;
    const online = async () => {
      await syncPendingCare(actor.id + ':' + workspace.id);
      if (!active) return;
      try {
        const latest = await api<Detail>('/api/plants/' + initial.plant.id);
        if (active) {
          setData(latest);
          setOptimistic(null);
        }
      } catch {
        /* Keep the saved local fact until a confirmed refresh. */
      }
    };
    window.addEventListener('online', online);
    return () => {
      active = false;
      window.removeEventListener('online', online);
    };
  }, [actor.id, workspace.id, initial.plant.id]);
  const recommendation = p.reasons?.find((reason) => reason.kind === 'care') || p.reasons?.[0];
  const nextCareTitle =
    recommendation?.kind === 'baseline'
      ? 'Build a visual baseline'
      : recommendation?.text.startsWith('The image is not reliable')
        ? 'Retake an observation'
        : p.score !== null && p.score < 70
          ? 'Inspect this plant'
          : 'Check soil moisture';
  async function refresh() {
    const latest = await api<Detail>(`/api/plants/${p.id}`);
    setData(latest);
    setOptimistic(null);
    router.refresh();
  }
  const processing = data.jobs.some((j) => j.status === 'queued' || j.status === 'processing');
  useEffect(() => {
    if (!processing) return;
    let active = true;
    const timer = setInterval(() => {
      api<Detail>(`/api/plants/${initial.plant.id}`)
        .then((next) => {
          if (active) setData(next);
        })
        .catch(() => {});
    }, 2000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [processing, initial.plant.id]);
  async function water() {
    if (workspace.role === 'viewer') {
      setError('Your role is read only.');
      return;
    }
    if (pending) return;
    setPending(true);
    setError(null);
    const key = crypto.randomUUID();
    setOptimistic({
      id: key,
      type: 'watered',
      at: new Date().toISOString(),
      note: 'Saving…',
      actor: actor.name,
    });
    try {
      const result = await saveFieldCare(actor.id, workspace.id, p.id, {
        type: 'watered',
        idempotencyKey: key,
      });
      if (result.pending) {
        setLastCare(null);
        setOptimistic({
          id: key,
          type: 'watered',
          at: new Date().toISOString(),
          note: 'Saved on this device · pending sync',
          actor: actor.name,
        });
        toast('Care saved on this device. It will sync when connected.');
      } else {
        setLastCare(result.id);
        toast('Watered. Care saved to the living history.');
        await refresh();
      }
    } catch (e) {
      setError((e as Error).message);
      setOptimistic(null);
    } finally {
      setPending(false);
    }
  }
  const history = data.history as { score: number; created_at: string; engine_version: string }[],
    analyses = data.analyses as {
      id: string;
      provider: string;
      model: string;
      features: { evidence_summary: string };
      created_at: string;
    }[],
    baseline = p.trend === 'baseline' || p.score === null;
  return (
    <article className={`plant-profile ${nfc ? 'identity-acquired' : ''}`}>
      <div className="profile-back">
        <Link className="text-link" href="/app/plants">
          <ArrowLeft size={18} />
          {t('Plants')}
        </Link>
        {['owner', 'admin', 'manager'].includes(workspace.role) && (
          <button className="button secondary small" onClick={() => setEdit(true)}>
            <Settings size={16} />
            {t('Edit plant')}
          </button>
        )}
      </div>
      <header className="profile-heading">
        <h1>{p.name}</h1>
        <p>{p.scientific_name}</p>
        <div className="profile-meta">
          <span>
            <Tag size={16} />
            {p.code}
          </span>
          <span>
            <MapPin size={16} />
            {p.location_name || 'Unplaced'}
          </span>
        </div>
      </header>
      <ErrorMessage message={error} />
      <div className="profile-grid">
        <div className="profile-visual">
          <PlantImage className="hero-plant" src={p.image} name={p.name} priority />
          <div className="identity-caption">
            <span>
              <Leaf size={16} />A living record
            </span>
            <span>{p.code}</span>
          </div>
        </div>
        <div className="profile-operation">
          <section className="panel profile-health">
            <Vitality score={p.score} size={125} />
            <div>
              <Status score={p.score} />
              <p className={`score-change trend-${p.trend}`}>
                {p.delta !== null
                  ? `${p.delta > 0 ? '+' : ''}${p.delta} since last snapshot`
                  : t('Building a baseline')}
              </p>
              <small>
                {baseline && `${t('Building a baseline')} · `}
                {Math.round((p.confidence || 0) * 100)}% model confidence estimate
              </small>
            </div>
            <div className="next-care">
              <small>{t('Next care')}</small>
              <h3>{t(nextCareTitle)}</h3>
              <p>{recommendation?.action || 'Water when the top layer is dry.'}</p>
              <small>
                Last watering:{' '}
                {p.last_watered ? `${dayAge(p.last_watered)} days ago` : 'not recorded'}
              </small>
            </div>
          </section>
          <section className="panel care-panel">
            <h2>{t('Care, in one tap.')}</h2>
            <div className="care-actions">
              {actions.map(([type, label, Icon]) => (
                <button
                  key={type}
                  disabled={pending || workspace.role === 'viewer'}
                  onClick={() => (type === 'watered' ? water() : setCare(type))}
                >
                  <Icon size={26} strokeWidth={1.5} aria-hidden="true" />
                  <span>{pending && type === 'watered' ? 'Saving…' : t(label)}</span>
                </button>
              ))}
            </div>
            {lastCare && (
              <div className="care-confirmed">
                <Check size={16} />
                <span>Watered recorded.</span>
                <button onClick={() => setCare('watered')}>{t('Add details')}</button>
              </div>
            )}
            <button
              className="button full"
              onClick={() => {
                setPhotoCare(undefined);
                setPhoto(true);
              }}
            >
              <Plus size={19} />
              {t('Add observation')}
            </button>
          </section>
          {processing && (
            <div className="analysis-processing" role="status">
              <LoaderCircle className="spin" size={20} />
              <span>
                {analysisProvider === 'workspace-agent' &&
                data.jobs.some((j) => j.remote_status === 'suspended')
                  ? 'The workspace agent is waiting for approval'
                  : analysisProvider === 'workspace-agent' &&
                      !data.jobs.some((j) => j.status === 'processing')
                    ? 'Waiting for the connected workspace agent'
                    : analysisProvider === 'chatgpt-subscription' &&
                        !data.jobs.some((j) => j.status === 'processing')
                      ? 'Waiting for the connected analysis worker'
                      : t('Analysis processing')}
                <small>The observation is saved. Health updates when analysis completes.</small>
              </span>
            </div>
          )}
          {analysisProvider === 'workspace-agent' && data.jobs.some((j) => j.conversation_url) && (
            <p>
              <a
                className="text-link"
                href={data.jobs.find((j) => j.conversation_url)?.conversation_url || ''}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open the workspace agent run
                <ArrowRight size={16} />
              </a>
            </p>
          )}
          {data.jobs
            .filter((j) => j.status === 'failed')
            .map((j) => (
              <div className="panel analysis-failed" key={String(j.id)}>
                <p>Analysis could not complete. Your photo is saved.</p>
                <button
                  className="button secondary small"
                  onClick={async () => {
                    try {
                      await mutate(`/api/jobs/${j.id}`, {});
                      await refresh();
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  {t('Retry analysis')}
                </button>
              </div>
            ))}
          <div className="analysis-provenance">
            {analysisProvider === 'development'
              ? 'Development analysis · simulated signals, not a plant diagnosis.'
              : analysisProvider === 'workspace-agent'
                ? 'Workspace Agent · Configured model: GPT-5.6 Luna. NABAT computes the score from saved visual estimates.'
                : analysisProvider === 'chatgpt-subscription'
                  ? 'GPT-6.1 Sol · Analysis requires your authorized local ChatGPT subscription worker.'
                  : 'Visual estimates support inspection; they are not a calibrated diagnosis.'}
          </div>
        </div>
        <section className="panel profile-insight">
          <h2>Understand the score.</h2>
          {p.reasons?.map((r, i) => (
            <div className="insight-reason" key={i}>
              <span className="dot dot-healthy" />
              <div>
                <strong>{r.text}</strong>
                <p>{r.action}</p>
                {r.sourceId && (
                  <a href={r.kind === 'care' ? `#event-${r.sourceId}` : `#analysis-${r.sourceId}`}>
                    View source
                    <ArrowRight size={14} />
                  </a>
                )}
              </div>
            </div>
          ))}
          {p.score === null && (
            <p>
              {data.jobs.length > 0
                ? 'Your observation is saved. The score becomes available when analysis completes.'
                : `${t('No observations yet')}. Add a photograph to begin a baseline.`}
            </p>
          )}
          <TrendChart
            points={history.slice(-10).map((h) => ({
              score: h.score,
              label: new Intl.DateTimeFormat(locale, {
                month: 'short',
                day: 'numeric',
                timeZone: workspace.timezone,
              }).format(new Date(h.created_at)),
            }))}
          />
        </section>
        <section className="panel timeline-panel">
          <h2>{t('A living history')}</h2>
          <div className="timeline">
            {[...(optimistic ? [optimistic] : []), ...data.timeline].map((event) => {
              const action = actions.find((a) => a[0] === event.type),
                Icon = action?.[2] || (event.type === 'observation' ? Camera : Leaf);
              return (
                <details className="timeline-event" key={event.id} id={`event-${event.id}`}>
                  <summary>
                    <span className="timeline-dot" />
                    <Icon size={23} strokeWidth={1.5} aria-hidden="true" />
                    <span>
                      <strong>
                        {t(
                          action?.[1] ||
                            (event.type === 'observation'
                              ? 'Observation added'
                              : event.type === 'assigned'
                                ? 'Caretaker assigned'
                                : 'First recorded'),
                        )}
                      </strong>
                      <small>
                        {dateLabel(event.at, locale, workspace.timezone)}
                        {event.actor && ` · ${event.actor}`}
                      </small>
                    </span>
                    {event.image && (
                      <PlantImage src={event.image} name="Recorded plant observation" />
                    )}
                    <span className="event-chevron">
                      <Plus size={16} />
                    </span>
                  </summary>
                  <div className="event-content">
                    <p>{event.note || 'No additional note.'}</p>
                    {event.status && <small>Analysis: {event.status}</small>}
                    {event.features && (
                      <>
                        <p>{event.features.evidence_summary}</p>
                        <dl className="signal-list">
                          {Object.entries(event.features)
                            .filter(([, v]) => typeof v === 'object' && v !== null && 'value' in v)
                            .map(([key, value]) => {
                              const v = value as {
                                value: number;
                                confidence: number;
                                evidence: string;
                              };
                              return (
                                <div key={key}>
                                  <dt>{key.replaceAll('_', ' ')}</dt>
                                  <dd>
                                    {Math.round(v.value * 100)}% · confidence{' '}
                                    {Math.round(v.confidence * 100)}%<small>{v.evidence}</small>
                                  </dd>
                                </div>
                              );
                            })}
                        </dl>
                      </>
                    )}
                  </div>
                </details>
              );
            })}
          </div>
          {data.timelineCursor && (
            <button
              className="button secondary full"
              disabled={loadingHistory}
              onClick={async () => {
                setLoadingHistory(true);
                try {
                  const page = await api<{ items: TimelineItem[]; nextCursor: string | null }>(
                    `/api/plants/${p.id}/timeline?cursor=${encodeURIComponent(data.timelineCursor!)}`,
                  );
                  setData((current) => ({
                    ...current,
                    timeline: [
                      ...current.timeline,
                      ...page.items.filter(
                        (item) => !current.timeline.some((existing) => existing.id === item.id),
                      ),
                    ],
                    timelineCursor: page.nextCursor,
                  }));
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setLoadingHistory(false);
                }
              }}
            >
              {loadingHistory ? t('Loading…') : 'Load older history'}
            </button>
          )}
        </section>
        <section className="panel species-panel">
          <h2>{t('Made for this place')}</h2>
          <dl>
            <div>
              <dt>
                <Sun size={21} />
                {t('Light')}
              </dt>
              <dd>{data.species.light}</dd>
            </div>
            <div>
              <dt>
                <Thermometer size={21} />
                {t('Temperature')}
              </dt>
              <dd>
                {data.species.temperature_min}–{data.species.temperature_max}°C
              </dd>
            </div>
            <div>
              <dt>{t('Origin')}</dt>
              <dd>{p.origin || 'Not recorded'}</dd>
            </div>
            <div>
              <dt>Estimated age at entry</dt>
              <dd>
                {p.age_months_estimate !== null
                  ? `${p.age_months_estimate} months`
                  : 'Not recorded'}
              </dd>
            </div>
            <div>
              <dt>Time in collection</dt>
              <dd>{dayAge(p.created_at)} days</dd>
            </div>
            <div>
              <dt>Acquired</dt>
              <dd>
                {p.acquired_at
                  ? new Intl.DateTimeFormat(locale, {
                      dateStyle: 'medium',
                      timeZone: 'UTC',
                    }).format(new Date(p.acquired_at))
                  : 'Not recorded'}
              </dd>
            </div>
          </dl>
          <p>{data.species.guidance}</p>
          <p className="helper">
            Check cadence: watering {data.species.watering_days} days; fertilising{' '}
            {data.species.fertilising_days} days. Adjust to the actual environment.
          </p>
        </section>
        <section className="panel provenance-panel">
          <h2>Observation evidence</h2>
          {analyses.map((a) => (
            <details key={a.id} id={`analysis-${a.id}`}>
              <summary>
                {dateLabel(a.created_at, locale, workspace.timezone)} · {a.provider} / {a.model}
              </summary>
              <p>{a.features.evidence_summary}</p>
              <small>Immutable analysis {a.id}</small>
            </details>
          ))}
          {workspace.role !== 'caretaker' && (
            <div className="profile-management">
              <button className="button secondary" onClick={() => setAssignment(true)}>
                <Users size={18} />
                {t('Assign caretaker')}
              </button>
              {workspace.role === 'owner' && (
                <button className="button secondary" onClick={() => setHandover(true)}>
                  {t('Request handover')}
                  <ArrowRight size={18} />
                </button>
              )}
              <Link className="button secondary" href="/app/tags">
                <Tag size={18} />
                Manage tag
              </Link>
              {!p.tag_token && (
                <button
                  className="button"
                  onClick={async () => {
                    try {
                      await mutate(`/api/plants/${p.id}/tag`, {});
                      toast('New tag identity generated.');
                      await refresh();
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  <Tag size={18} />
                  Generate tag
                </button>
              )}
            </div>
          )}
        </section>
      </div>
      <div className="profile-dock" aria-label="Quick plant care">
        <button
          className="button"
          disabled={pending || workspace.role === 'viewer'}
          onClick={water}
        >
          <Droplets size={21} aria-hidden="true" />
          {pending ? 'Saving…' : t('Watered')}
        </button>
        <button
          className="button secondary"
          onClick={() => {
            setPhotoCare(undefined);
            setPhoto(true);
          }}
        >
          <Camera size={21} aria-hidden="true" />
          {t('Add observation')}
        </button>
      </div>
      {care && (
        <CareSheet
          type={care}
          plantId={p.id}
          locations={locations}
          existingId={care === 'watered' ? lastCare || undefined : undefined}
          onClose={() => setCare(null)}
          onSaved={async (id, withPhoto) => {
            setCare(null);
            if (id.startsWith('pending:')) {
              toast('Care saved on this device. It will sync when connected.');
              setLastCare(null);
              return;
            }
            toast('Care saved.');
            await refresh();
            if (withPhoto) {
              setPhotoCare(id);
              setPhoto(true);
            }
          }}
        />
      )}{' '}
      {photo && (
        <PhotoCapture
          plantId={p.id}
          careEventId={photoCare}
          onClose={() => setPhoto(false)}
          onUploaded={() => {
            setPhoto(false);
            toast('Observation saved. Analysis queued.');
            refresh().catch((e) => setError(e.message));
          }}
        />
      )}
      {edit && (
        <ProfileEditor
          plant={p}
          onClose={() => setEdit(false)}
          onSaved={() => {
            setEdit(false);
            refresh();
          }}
        />
      )}
      {handover && (
        <SimpleAction
          title={t('Request handover')}
          description="The destination Owner must accept. Plant identity and history follow the plant; your workspace then loses access."
          label={t('Destination workspace ID')}
          onClose={() => setHandover(false)}
          onSubmit={async (value) => {
            await mutate(`/api/plants/${p.id}/transfer`, { organisationId: value });
            setHandover(false);
            toast('Handover requested. Waiting for the destination Owner.');
          }}
        />
      )}
      {assignment && (
        <AssignmentSheet
          team={team}
          plantId={p.id}
          onClose={() => setAssignment(false)}
          onSaved={() => {
            setAssignment(false);
            refresh();
          }}
        />
      )}
    </article>
  );
}
function CareSheet({
  type,
  plantId,
  locations,
  existingId,
  onClose,
  onSaved,
}: {
  type: CareType;
  plantId: string;
  locations: Location[];
  existingId?: string;
  onClose: () => void;
  onSaved: (id: string, photo: boolean) => void;
}) {
  const { actor, workspace } = useApp(),
    { t } = useLocale();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const [key] = useState(() => crypto.randomUUID());
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    try {
      const d = {
        type,
        amountMl: f.get('amount') ? Number(f.get('amount')) : null,
        note: f.get('note') || '',
        locationId: f.get('location') || null,
        idempotencyKey: key,
      };
      const result = existingId
        ? await mutate(`/api/care/${existingId}`, d, 'PATCH')
        : type === 'moved'
          ? await mutate<{ id: string }>(`/api/plants/${plantId}/care`, d)
          : await saveFieldCare(actor.id, workspace.id, plantId, d);
      onSaved(existingId || String(result.id), f.get('photo') === 'on');
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <Dialog title={t(actions.find((a) => a[0] === type)?.[1] || 'Save care')} onClose={onClose}>
      <form onSubmit={submit}>
        <p>
          Performed by <strong>{actor.name}</strong>. Timestamp is recorded when saved.
        </p>
        {(type === 'watered' || type === 'fertilised') && (
          <label>
            {t('Amount (ml)')}
            <input name="amount" type="number" min="0" max="100000" inputMode="numeric" />
          </label>
        )}
        {type === 'moved' && (
          <label>
            {t('Location')}
            <select name="location" required>
              <option value="">Choose destination</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          {t('Note')}
          <textarea name="note" maxLength={2000} />
        </label>
        <label className="checkbox-inline">
          <input type="checkbox" name="photo" />
          Add a photo after saving
        </label>
        <ErrorMessage message={error} />
        <button className="button full" disabled={busy}>
          {busy ? t('Loading…') : t('Save care')}
        </button>
      </form>
    </Dialog>
  );
}
function ProfileEditor({
  plant,
  onClose,
  onSaved,
}: {
  plant: Detail['plant'];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useLocale();
  const [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
  return (
    <Dialog title={t('Edit plant')} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          setBusy(true);
          try {
            await mutate(
              `/api/plants/${plant.id}`,
              {
                name: f.get('name'),
                origin: f.get('origin'),
                publicPassport: f.get('public') === 'on',
              },
              'PATCH',
            );
            onSaved();
          } catch (e) {
            setError((e as Error).message);
            setBusy(false);
          }
        }}
      >
        <label>
          {t('Name')}
          <input name="name" defaultValue={plant.name} required maxLength={120} />
        </label>
        <label>
          {t('Origin')}
          <input name="origin" defaultValue={plant.origin} maxLength={250} />
        </label>
        <label className="checkbox-inline">
          <input type="checkbox" name="public" defaultChecked={plant.public_passport} />
          {t('Public plant passport')}
        </label>
        <p className="helper">
          Only name, plant code and species are public. Operational records remain private.
        </p>
        <ErrorMessage message={error} />
        <button className="button full" disabled={busy}>
          {t('Save')}
        </button>
      </form>
    </Dialog>
  );
}
function SimpleAction({
  title,
  description,
  label,
  onClose,
  onSubmit,
}: {
  title: string;
  description: string;
  label: string;
  onClose: () => void;
  onSubmit: (value: string) => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
  return (
    <Dialog title={title} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          setBusy(true);
          try {
            await onSubmit(String(f.get('value')));
          } catch (e) {
            setError((e as Error).message);
            setBusy(false);
          }
        }}
      >
        <p>{description}</p>
        <label>
          {label}
          <input name="value" required />
        </label>
        <ErrorMessage message={error} />
        <button className="button full" disabled={busy}>
          {title}
        </button>
      </form>
    </Dialog>
  );
}
function AssignmentSheet({
  team,
  plantId,
  onClose,
  onSaved,
}: {
  team: { user_id: string; name: string }[];
  plantId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useLocale();
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog title={t('Assign caretaker')} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await mutate(`/api/plants/${plantId}/assignment`, {
              userId: new FormData(e.currentTarget).get('user'),
            });
            onSaved();
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        <label>
          {t('Caretaker')}
          <select name="user" required>
            {team.map((u) => (
              <option key={u.user_id} value={u.user_id}>
                {u.name}
              </option>
            ))}
          </select>
        </label>
        <ErrorMessage message={error} />
        <button className="button full">{t('Save')}</button>
      </form>
    </Dialog>
  );
}
