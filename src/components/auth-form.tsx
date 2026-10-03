'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import { Brand } from './brand';
import { ErrorMessage } from './ui';
import { useLocale } from './locale';
import { mutate, api } from '@/lib/client';
export function AuthForm({
  register = false,
  demoAvailable = false,
}: {
  register?: boolean;
  demoAvailable?: boolean;
}) {
  const { t } = useLocale(),
    router = useRouter();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  async function go() {
    const bootstrap = await api<{ workspace: unknown }>('/api/bootstrap');
    const next = new URLSearchParams(window.location.search).get('next');
    router.push(
      next && /^\/p\/[\w-]+$/.test(next) ? next : bootstrap.workspace ? '/app' : '/onboarding',
    );
    router.refresh();
  }
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const f = new FormData(e.currentTarget);
    try {
      await mutate(`/api/auth/${register ? 'register' : 'login'}`, {
        name: f.get('name'),
        email: f.get('email'),
        password: f.get('password'),
      });
      await go();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <main id="main-content" className="auth-page">
      <div className="auth-art">
        <Brand />
        <div>
          <h1>
            Every plant,
            <br />
            known.
          </h1>
          <p>A living record begins with a little care.</p>
        </div>
      </div>
      <div className="auth-content">
        <Link className="text-link" href="/">
          {t('Back to NABAT')}
        </Link>
        <div className="auth-form">
          <Brand compact />
          <h1>{register ? 'Start a living collection.' : 'Welcome back.'}</h1>
          <p>
            {register
              ? 'Create your account. Give your first plant an identity.'
              : 'Your plants and their history are waiting.'}
          </p>
          <form onSubmit={submit}>
            {register && (
              <label>
                {t('Your name')}
                <input name="name" autoComplete="name" required maxLength={120} />
              </label>
            )}
            <label>
              {t('Email')}
              <input name="email" type="email" autoComplete="email" required maxLength={254} />
            </label>
            <label>
              {t('Password')}
              <input
                name="password"
                type="password"
                autoComplete={register ? 'new-password' : 'current-password'}
                required
                minLength={register ? 12 : 1}
                maxLength={128}
              />
              {register && (
                <small>At least 12 characters. Password managers and paste are welcome.</small>
              )}
            </label>
            <ErrorMessage message={error} />
            <button className="button full" disabled={busy}>
              {busy ? t('Loading…') : t(register ? 'Create account' : 'Sign in')}
              <ArrowRight size={18} />
            </button>
          </form>
          <p className="auth-switch">
            {register ? 'Already have an account?' : 'New to NABAT?'}{' '}
            <Link href={register ? '/login' : '/register'}>
              {t(register ? 'Sign in' : 'Create account')}
            </Link>
          </p>
          {demoAvailable && (
            <>
              <div className="or-divider">
                <span>or</span>
              </div>
              <button
                className="button secondary full"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await mutate('/api/auth/demo', {});
                    await go();
                  } catch (e) {
                    setError((e as Error).message);
                    setBusy(false);
                  }
                }}
              >
                {t('Explore the demo')}
              </button>
              <small className="demo-caption">
                Synthetic hotel workspace. Changes are saved and shared.
              </small>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
