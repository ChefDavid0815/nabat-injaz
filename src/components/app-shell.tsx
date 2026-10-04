'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useContext, useState, useEffect } from 'react';
import {
  House,
  Leaf,
  MapPin,
  Bell,
  Tag,
  Users,
  ChartNoAxesColumn,
  Settings,
  Plus,
  ChevronDown,
  Search,
  LogOut,
  ArrowRight,
  Globe,
  X,
  CalendarCheck,
} from 'lucide-react';
import { Brand } from './brand';
import { Dialog, ErrorMessage, PlantImage } from './ui';
import { useLocale } from './locale';
import { api, mutate } from '@/lib/client';
import type { Actor, Workspace, Plant } from '@/domain/types';
const nav = [
  ['Dashboard', '/app', House],
  ['Today', '/app/today', CalendarCheck],
  ['Plants', '/app/plants', Leaf],
  ['Locations', '/app/locations', MapPin],
  ['Alerts', '/app/alerts', Bell],
  ['Tags', '/app/tags', Tag],
  ['Team', '/app/team', Users],
  ['Analytics', '/app/analytics', ChartNoAxesColumn],
  ['Settings', '/app/settings', Settings],
] as const;
interface AppContext {
  actor: Actor;
  workspace: Workspace;
  analysisProvider: string;
  analysisModel: string;
  toast: (message: string) => void;
  openSearch: () => void;
}
const Context = createContext<AppContext | null>(null);
export function useApp() {
  const value = useContext(Context);
  if (!value) throw new Error('Workspace context is missing');
  return value;
}
export function AppShell({
  actor,
  workspace,
  workspaces,
  analysisProvider,
  analysisModel,
  children,
}: {
  actor: Actor;
  workspace: Workspace;
  workspaces: Workspace[];
  analysisProvider: string;
  analysisModel: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname(),
    router = useRouter(),
    { t, locale } = useLocale();
  const [switcher, setSwitcher] = useState(false),
    [search, setSearch] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault();
        setSearch(true);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(''), 6000);
    return () => clearTimeout(timer);
  }, [message]);
  useEffect(() => {
    if (pathname.startsWith('/p/'))
      mutate('/api/workspaces/select', { id: workspace.id }).catch((e) => setError(e.message));
  }, [pathname, workspace.id]);
  const selected = (href: string) =>
    href === '/app' ? pathname === '/app' : pathname.startsWith(href);
  async function changeWorkspace(id: string) {
    try {
      await mutate('/api/workspaces/select', { id });
      setSwitcher(false);
      router.push('/app');
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function changeLocale() {
    try {
      await mutate('/api/locale', { locale: locale === 'en' ? 'ar' : 'en' });
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Context.Provider
      value={{
        actor,
        workspace,
        analysisProvider,
        analysisModel,
        toast: setMessage,
        openSearch: () => setSearch(true),
      }}
    >
      <div className="app-shell">
        <aside className="sidebar">
          <Link href="/" aria-label="NABAT home">
            <Brand />
          </Link>
          <div className="workspace-switcher">
            <button aria-expanded={switcher} onClick={() => setSwitcher(!switcher)}>
              {workspace.name}
              <ChevronDown size={16} />
            </button>
            {switcher && (
              <div className="workspace-menu">
                {workspaces.map((w) => (
                  <button key={w.id} onClick={() => changeWorkspace(w.id)}>
                    {w.name}
                    {w.id === workspace.id && <span>✓</span>}
                  </button>
                ))}
                <Link href="/onboarding">
                  {t('Create workspace')}
                  <Plus size={16} />
                </Link>
              </div>
            )}
          </div>
          <nav aria-label="Workspace navigation">
            {nav
              .filter(([label]) => label !== 'Tags' || workspace.role !== 'caretaker')
              .map(([label, href, Icon]) => (
                <Link
                  key={href}
                  href={href}
                  className={selected(href) ? 'selected' : ''}
                  aria-current={selected(href) ? 'page' : undefined}
                >
                  <Icon size={21} strokeWidth={1.6} aria-hidden="true" />
                  {t(label)}
                </Link>
              ))}
          </nav>
          <div className="sidebar-bottom">
            <button className="language-button" onClick={changeLocale}>
              <Globe size={18} aria-hidden="true" />
              {locale === 'en' ? 'العربية' : 'English'}
            </button>
            <Link className="identity" href="/app/settings">
              <span className="avatar">
                {actor.name
                  .split(' ')
                  .map((n) => n[0])
                  .slice(0, 2)
                  .join('')}
              </span>
              <span>
                <strong>{actor.name}</strong>
                <small>{t(workspace.role.charAt(0).toUpperCase() + workspace.role.slice(1))}</small>
              </span>
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </div>
        </aside>
        <div className="app-content">
          <header className="mobile-header">
            <Link href="/" aria-label="NABAT home">
              <Brand />
            </Link>
            <button
              className="icon-button"
              aria-label={t('Search plants')}
              onClick={() => setSearch(true)}
            >
              <Search size={21} />
            </button>
          </header>
          {workspace.name === 'NABAT Demo Hotel' && (
            <div className="demo-notice">
              Synthetic demo workspace · Sample plants, history and analysis
            </div>
          )}
          <ErrorMessage message={error} />
          <main id="main-content" className="canvas">
            {children}
          </main>
        </div>
        <nav className="bottom-nav" aria-label="Mobile navigation">
          {[
            ['Home', '/app', House],
            ['Plants', '/app/plants', Leaf],
            workspace.kind === 'business'
              ? ['Today', '/app/today', CalendarCheck]
              : ['Add', '/app/plants/new', Plus],
            ['Alerts', '/app/alerts', Bell],
            ['Account', '/app/settings', Users],
          ].map(([label, href, Icon]) => {
            const I = Icon as typeof House;
            return (
              <Link
                key={String(href)}
                href={String(href)}
                className={`${selected(String(href)) ? 'selected' : ''} ${label === 'Add' ? 'add-tab' : ''}`}
              >
                <I size={22} aria-hidden="true" />
                <span>{t(String(label))}</span>
              </Link>
            );
          })}
        </nav>
      </div>
      {message && (
        <div className="toast" role="status">
          <Leaf size={18} aria-hidden="true" />
          <span>{message}</span>
          <button className="icon-button" aria-label={t('Close')} onClick={() => setMessage('')}>
            <X size={16} />
          </button>
        </div>
      )}
      {search && <CommandSearch onClose={() => setSearch(false)} />}
    </Context.Provider>
  );
}
function CommandSearch({ onClose }: { onClose: () => void }) {
  const { workspace } = useApp(),
    { t } = useLocale();
  const [value, setValue] = useState(''),
    [results, setResults] = useState<Plant[]>([]),
    [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api<{ items: Plant[] }>(
        `/api/workspaces/${workspace.id}/plants?search=${encodeURIComponent(value)}`,
        { signal: controller.signal },
      )
        .then((d) => setResults(d.items.slice(0, 8)))
        .catch((e) => {
          if (e.name !== 'AbortError') setError(e.message);
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [value, workspace.id]);
  return (
    <Dialog title={t('Search plants')} onClose={onClose}>
      <input
        aria-label={t('Search plants')}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Name, plant code or species"
      />
      <ErrorMessage message={error} />
      <div className="command-results">
        {results.map((p) => (
          <Link key={p.id} href={`/app/plants/${p.id}`} onClick={onClose}>
            <PlantImage src={p.image} name={p.name} />
            <span>
              <strong>{p.name}</strong>
              <small>
                {p.code} · {p.location_name}
              </small>
            </span>
            <ArrowRight size={18} />
          </Link>
        ))}
      </div>
    </Dialog>
  );
}
export function PageHeading({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  const { t } = useLocale();
  return (
    <header className="page-heading">
      <div>
        <h1>{t(title)}</h1>
        {description && <p>{t(description)}</p>}
      </div>
      <div className="heading-actions">{action}</div>
    </header>
  );
}
export function SignOut() {
  const router = useRouter(),
    { t } = useLocale();
  return (
    <button
      className="button secondary"
      onClick={async () => {
        await mutate('/api/auth/logout', {});
        router.push('/');
        router.refresh();
      }}
    >
      <LogOut size={18} aria-hidden="true" />
      {t('Sign out')}
    </button>
  );
}
