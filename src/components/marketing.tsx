'use client';
import Link from 'next/link';
import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Radio, Leaf, ChartNoAxesColumn, ArrowRight, Droplets, Camera, Sprout } from 'lucide-react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Brand } from './brand';
import { Vitality, ErrorMessage, PlantImage } from './ui';
import { useLocale } from './locale';
import { mutate } from '@/lib/client';
export function Marketing({ demoAvailable }: { demoAvailable: boolean }) {
  const { t, locale } = useLocale(),
    router = useRouter(),
    root = useRef<HTMLElement>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    gsap.registerPlugin(ScrollTrigger);
    const ctx = gsap.context(() => {
      const line = document.querySelector<SVGPathElement>('.growth-line');
      if (line) {
        const length = line.getTotalLength();
        gsap.fromTo(
          line,
          { strokeDasharray: length, strokeDashoffset: length },
          {
            strokeDashoffset: 0,
            duration: 1.2,
            ease: 'power2.out',
            scrollTrigger: { trigger: line, start: 'top 85%', once: true },
          },
        );
      }
    }, root);
    return () => ctx.revert();
  }, []);
  async function demo() {
    setBusy(true);
    setError(null);
    try {
      await mutate('/api/auth/demo', {});
      router.push('/app');
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  const demoAction = demoAvailable ? (
    <button className="button secondary" onClick={demo} disabled={busy}>
      {busy ? t('Loading…') : t('Explore the demo')}
    </button>
  ) : (
    <Link href="/register" className="button secondary">
      {t('Create your workspace')}
    </Link>
  );
  return (
    <main ref={root} id="main-content" className="marketing">
      <header className="marketing-nav">
        <Link href="/" aria-label="NABAT home">
          <Brand />
        </Link>
        <nav aria-label="Main navigation">
          <a href="#how-it-works">{t('How it works')}</a>
          <a href="#teams">{t('For teams')}</a>
          <Link href="/login">{t('Sign in')}</Link>
          <Link className="button" href="/register">
            {t('Start your collection')}
          </Link>
        </nav>
      </header>
      <section className="marketing-hero">
        <div className="hero-copy">
          <h1>
            {locale === 'en' ? (
              <>
                Every plant
                <br />
                has a history.
              </>
            ) : (
              t('Every plant has a history.')
            )}
          </h1>
          <h2>{t('Give it an identity.')}</h2>
          <p>
            One tap connects a living plant to its care, its changes, and everything that comes
            next.
          </p>
          <div className="hero-actions">
            <Link className="button" href="/register">
              {t('Start your collection')}
            </Link>
            {demoAction}
          </div>
          <ErrorMessage message={error} />
        </div>
        <div className="hero-photograph">
          <Image
            src="/images/monstera.webp"
            alt="Monstera with a physical NABAT NFC identity tag"
            fill
            priority
            sizes="(max-width: 700px) 100vw, 54vw"
          />
          <div className="hero-record">
            <strong>Monstera No. 04</strong>
            <small>A living record</small>
            <Vitality score={86} size={115} />
            <span>{t('Healthy')}</span>
            <small className="illustrative-label">Illustrative profile</small>
          </div>
        </div>
      </section>
      <div className="tap-sequence">
        {[
          [Radio, 'Tap its tag'],
          [Leaf, 'Know what changed'],
          [ChartNoAxesColumn, 'Care with confidence'],
        ].map(([Icon, label], i) => {
          const I = Icon as typeof Leaf;
          return (
            <div key={String(label)}>
              <span className="sequence-icon">
                <I size={27} strokeWidth={1.5} />
              </span>
              <span className="sequence-number">{String(i + 1).padStart(2, '0')}</span>
              <h3>{t(String(label))}</h3>
            </div>
          );
        })}
      </div>
      <section className="history-marketing" id="how-it-works">
        <h2>{t('A small tag. A lifetime of context.')}</h2>
        <div className="history-composition">
          <div className="physical-identity">
            <div className="radio-rings">
              <span />
              <span />
              <span />
            </div>
            <div className="physical-tag">
              <Brand compact />
              <strong>NABAT</strong>
              <span>NAB-004</span>
              <Radio size={28} />
              <small>Tap to open</small>
            </div>
            <div className="identity-connector" />
          </div>
          <PlantImage src="/images/monstera.webp" name="A plant with a lifetime identity" />
          <ol className="marketing-timeline">
            {[
              [Sprout, 'First recorded', 'An identity begins.'],
              [Droplets, 'Watered', 'Care becomes history.'],
              [Camera, 'Observation added', 'A new leaf. A new chapter.'],
              [ChartNoAxesColumn, 'Change understood', 'Compare observations over time.'],
            ].map(([Icon, title, caption]) => {
              const I = Icon as typeof Leaf;
              return (
                <li key={String(title)}>
                  <I size={25} strokeWidth={1.5} />
                  <div>
                    <h3>{t(String(title))}</h3>
                    <p>{String(caption)}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </section>
      <section className="change-marketing">
        <div>
          <h2>
            Know the change.
            <br />
            Not just the photograph.
          </h2>
          <p>
            A new observation adds context to the ones before it. See the signals behind the score,
            and the next step for care.
          </p>
          <Link href={demoAvailable ? '/login' : '/register'} className="text-link">
            {demoAvailable ? 'Explore a living record' : 'Start a living record'}
            <ArrowRight size={20} />
          </Link>
        </div>
        <div className="growth-composition">
          <div className="observation-pair">
            <PlantImage src="/images/monstera.webp" name="Illustrative earlier plant observation" />
            <PlantImage src="/images/monstera.webp" name="Illustrative repeat plant observation" />
          </div>
          <svg
            viewBox="0 0 600 240"
            role="img"
            aria-label="Illustrative growth curve, not measured data"
          >
            <line x1="20" x2="580" y1="210" y2="210" stroke="currentColor" opacity=".4" />
            <path
              className="growth-line"
              d="M20 190C100 190 100 140 180 150S250 110 320 108S425 78 480 70S535 15 580 15"
              fill="none"
              stroke="var(--chlorophyll)"
              strokeWidth="3"
            />
            <circle
              cx="180"
              cy="150"
              r="6"
              fill="var(--green)"
              stroke="var(--chlorophyll)"
              strokeWidth="3"
            />
            <circle
              cx="480"
              cy="70"
              r="6"
              fill="var(--green)"
              stroke="var(--chlorophyll)"
              strokeWidth="3"
            />
          </svg>
          <small>Illustrative observation comparison</small>
        </div>
      </section>
      <section className="teams-marketing" id="teams">
        <div>
          <h2>{t('One plant. Or a thousand.')}</h2>
          <p>
            A shared view for the people who care. Find priorities by location, keep care
            accountable, and let every handover carry the history forward.
          </p>
          {demoAvailable ? (
            <button className="button" onClick={demo} disabled={busy}>
              Explore fleet management
              <ArrowRight size={18} />
            </button>
          ) : (
            <Link className="button" href="/register">
              {t('Create your workspace')}
            </Link>
          )}
        </div>
        <div className="fleet-preview">
          <h3>NABAT Demo Hotel</h3>
          <div className="preview-labels">
            <span>Plants</span>
            <span>Location</span>
            <span>Health</span>
          </div>
          {[
            ['Peace Lily', 'peace-lily', 42, 'Lobby'],
            ['Areca Palm', 'areca', 68, 'Restaurant'],
            ['Monstera', 'monstera', 86, 'Courtyard'],
          ].map(([name, image, score, location]) => (
            <div className="preview-row" key={String(name)}>
              <PlantImage src={`/images/${image}.webp`} name={String(name)} />
              <span>{name}</span>
              <small>{location}</small>
              <Vitality score={Number(score)} size={54} />
            </div>
          ))}
          <p>Illustrative demo workspace.</p>
        </div>
      </section>
      <footer className="marketing-footer">
        <div>
          <h2>{t('Start a living collection.')}</h2>
          <p>Create your first plant. Give it a tag. Let its history begin.</p>
          <Link className="button" href="/register">
            {t('Create your workspace')}
            <ArrowRight size={18} />
          </Link>
        </div>
        <div className="footer-line">
          <Brand />
          <span>{t('Every plant, known.')}</span>
          <nav>
            <Link href="/login">{t('Sign in')}</Link>
            <Link href={demoAvailable ? '/login' : '/register'}>
              {t(demoAvailable ? 'Explore the demo' : 'Create your workspace')}
            </Link>
          </nav>
        </div>
      </footer>
    </main>
  );
}
