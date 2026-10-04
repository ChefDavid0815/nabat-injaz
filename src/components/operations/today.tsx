'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Check, ClipboardList, RefreshCw, WifiOff } from 'lucide-react';
import type { OperationTask } from '@/domain/operations/contracts';
import type { Actor, Location } from '@/domain/types';
import {
  pendingCare,
  savePendingCare,
  syncPendingCare,
  type PendingCare,
} from '@/lib/operations-outbox';
import './today.css';
type Session = {
  id: string;
  status: string;
  revision: number;
  owner_id: string;
  location_name: string | null;
  plant_count: number;
  visited_count: number;
};
export function OperationsToday({
  workspace,
  actor,
  initialTasks,
  initialSessions,
  locations,
}: {
  workspace: { id: string; name: string; role: string };
  actor: Actor;
  initialTasks: OperationTask[];
  initialSessions: Session[];
  locations: Location[];
}) {
  const [tasks, setTasks] = useState(initialTasks),
    [sessions, setSessions] = useState(initialSessions),
    [pending, setPending] = useState<PendingCare[]>([]);
  const [filter, setFilter] = useState('all'),
    [location, setLocation] = useState(locations[0]?.id || ''),
    [busy, setBusy] = useState<string | null>(null),
    [message, setMessage] = useState('');
  const [offline, setOffline] = useState(false);
  const scope = actor.id + ':' + workspace.id;
  const canWrite = workspace.role !== 'viewer';
  const sessionContext = useRef<Record<string, string>>({});
  const request = async (route: string, payload: unknown) => {
    const response = await fetch('/api/v1/operations/' + workspace.id + '/' + route, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Try again.');
    return result;
  };
  const refresh = useCallback(async () => {
    setOffline(!navigator.onLine);
    await syncPendingCare(scope);
    setPending(await pendingCare(scope));
    if (!navigator.onLine) return;
    const results = await Promise.allSettled(
      ['tasks', 'sessions'].map(async (route) => {
        const response = await fetch('/api/v1/operations/' + workspace.id + '/' + route);
        if (!response.ok) throw new Error('Sign in to sync your care.');
        return response.json();
      }),
    );
    if (results[0].status === 'fulfilled') setTasks(results[0].value);
    if (results[1].status === 'fulfilled') {
      setSessions(results[1].value);
      const active = (results[1].value as Session[]).find(
        (s) => s.status === 'active' && s.owner_id === actor.id,
      );
      if (active) {
        try {
          const response = await fetch(
            '/api/v1/operations/' + workspace.id + '/sessions/' + active.id,
          );
          if (response.ok) {
            const detail = await response.json();
            sessionContext.current = Object.fromEntries(
              detail.plants.map((p: { plant_id: string }) => [p.plant_id, active.id]),
            );
            localStorage.setItem('nabat-session:' + scope, JSON.stringify(sessionContext.current));
          }
        } catch {
          // Keep the last confirmed session mapping while connectivity is interrupted.
        }
      } else {
        sessionContext.current = {};
        localStorage.removeItem('nabat-session:' + scope);
      }
    }
  }, [scope, workspace.id, actor.id]);
  useEffect(() => {
    void Promise.resolve().then(refresh);
    const timer = setInterval(() => void refresh(), 30000);
    const online = () => void refresh();
    window.addEventListener('online', online);
    window.addEventListener('offline', online);
    return () => {
      clearInterval(timer);
      window.removeEventListener('online', online);
      window.removeEventListener('offline', online);
    };
  }, [refresh]);
  async function care(task: OperationTask) {
    setBusy(task.id);
    try {
      const id = crypto.randomUUID();
      const cached = localStorage.getItem('nabat-session:' + scope);
      if (cached) sessionContext.current = JSON.parse(cached);
      await savePendingCare({
        id,
        scope,
        workspace: workspace.id,
        state: 'pending',
        payload: {
          plantId: task.plant_id,
          expectedActorId: actor.id,
          type: task.kind,
          taskId: task.id,
          idempotencyKey: id,
          occurredAt: new Date().toISOString(),
          sessionId: sessionContext.current[task.plant_id],
        },
      });
      setMessage('Care saved on this device.');
      await refresh();
    } catch {
      setMessage('Care could not be saved on this device. Keep this page open and retry.');
    } finally {
      setBusy(null);
    }
  }
  async function start() {
    setBusy('session');
    try {
      await request('sessions', { locationId: location, idempotencyKey: crypto.randomUUID() });
      await refresh();
      setMessage('Maintenance session started.');
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(null);
    }
  }
  async function finish(session: Session) {
    setBusy(session.id);
    try {
      await syncPendingCare(scope);
      if ((await pendingCare(scope)).length)
        throw new Error('Sync or review your pending care before finishing.');
      await request('sessions/' + session.id + '/finish', {
        revision: session.revision,
        action: 'complete',
        idempotencyKey: crypto.randomUUID(),
      });
      await refresh();
      setMessage('Maintenance session completed.');
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(null);
    }
  }
  const visible = tasks.filter((task) =>
    filter === 'mine'
      ? task.assignee_id === actor.id
      : filter === 'unassigned'
        ? !task.assignee_id
        : filter === 'complete'
          ? task.status === 'completed'
          : task.status !== 'cancelled',
  );
  const completed = tasks.filter((task) => task.status === 'completed').length;
  return (
    <div className="operations-today">
      <header className="page-heading">
        <div>
          <h1>Today</h1>
          <p>{workspace.name} · Care, with a clear next step.</p>
        </div>
        <button className="button secondary" onClick={() => void refresh()}>
          <RefreshCw size={18} aria-hidden="true" />
          Refresh
        </button>
      </header>
      <div className="operations-sync" role="status">
        {offline ? (
          <WifiOff size={18} aria-hidden="true" />
        ) : (
          <Check size={18} aria-hidden="true" />
        )}
        <span>
          {offline
            ? 'Working offline'
            : pending.length
              ? pending.length + ' changes pending'
              : 'Synced'}
          {pending.some((item) => item.state === 'blocked') ? ' · Review required' : ''}
        </span>
      </div>
      {message && (
        <p className="operations-notice" role="status">
          {message}
        </p>
      )}
      <div className="operations-summary">
        <strong>
          {completed} / {tasks.length}
        </strong>
        <span>tasks completed today</span>
        <progress
          value={completed}
          max={Math.max(1, tasks.length)}
          aria-label="Today's completion"
        />
      </div>
      <div className="operations-filter" aria-label="Work views">
        {[
          ['all', 'All work'],
          ['mine', 'My work'],
          ['unassigned', 'Unassigned'],
          ['complete', 'Completed'],
        ].map(([value, label]) => (
          <button
            key={value}
            className={'button ' + (filter === value ? '' : 'secondary')}
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="operations-task-list">
        {visible.map((task) => {
          const saving = pending.some((item) => item.payload.taskId === task.id);
          return (
            <article key={task.id} className="operations-task">
              <div className="operations-task-icon">
                <ClipboardList size={22} aria-hidden="true" />
              </div>
              <div>
                <Link href={'/app/plants/' + task.plant_id}>
                  <h2>{task.plant_name}</h2>
                </Link>
                <p>{task.title}</p>
                <small>
                  {task.plant_code} · {task.location_name || 'Unplaced'} ·{' '}
                  {task.assignee_name || 'Unassigned'}
                </small>
              </div>
              <div className="operations-task-action">
                {task.status === 'completed' ? (
                  <span className="status status-healthy">Completed</span>
                ) : saving ? (
                  <span className="status status-watch">Saved · pending sync</span>
                ) : ['watered', 'fertilised', 'inspected'].includes(task.kind) ? (
                  <button
                    className="button secondary"
                    disabled={!canWrite || busy === task.id}
                    onClick={() => void care(task)}
                  >
                    {busy === task.id ? 'Saving…' : 'Log ' + task.kind}
                  </button>
                ) : (
                  <Link className="button secondary" href={'/app/plants/' + task.plant_id}>
                    Open plant
                  </Link>
                )}
              </div>
            </article>
          );
        })}
        {visible.length === 0 && (
          <div className="panel operations-clear">
            <h2>All clear.</h2>
            <p>No tasks in this view. Your plants are ready for their next visit.</p>
          </div>
        )}
      </div>
      <section className="panel operations-sessions">
        <h2>Maintenance sessions</h2>
        <p>Choose a location, then record visits as you care for each plant.</p>
        <div className="operations-start">
          <label>
            Location
            <select value={location} onChange={(e) => setLocation(e.target.value)}>
              {locations.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <button
            className="button"
            disabled={!canWrite || !location || busy === 'session' || offline}
            onClick={() => void start()}
          >
            {busy === 'session' ? 'Starting…' : 'Start maintenance session'}
          </button>
        </div>
        {sessions.map((session) => (
          <div key={session.id} className="operations-session">
            <div>
              <strong>{session.location_name || 'Selected plants'}</strong>
              <p>
                {session.visited_count} / {session.plant_count} visited · {session.status}
              </p>
            </div>
            {session.status === 'active' && session.owner_id === actor.id && (
              <button
                className="button secondary"
                disabled={busy === session.id || offline}
                onClick={() => void finish(session)}
              >
                Finish session
              </button>
            )}
          </div>
        ))}
      </section>
      {pending
        .filter((item) => item.state === 'blocked')
        .map((item) => (
          <div className="operations-notice" key={item.id}>
            <strong>Care needs review</strong>
            <p>{item.error}</p>
            <small>Request {item.id} is preserved on this device.</small>
          </div>
        ))}
    </div>
  );
}
