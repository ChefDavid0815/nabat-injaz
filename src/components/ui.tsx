'use client';
import { useEffect, useRef, useId } from 'react';
import { X, Leaf } from 'lucide-react';
import Image from 'next/image';
import { healthState, type HealthState } from '@/domain/types';
import { useLocale } from './locale';
export function Status({ score, state }: { score?: number | null; state?: string }) {
  const { t } = useLocale();
  const value = state || healthState(score ?? null);
  return (
    <span className={`status status-${value}`}>
      {t(value.charAt(0).toUpperCase() + value.slice(1))}
    </span>
  );
}
export function PlantImage({
  src,
  name,
  className = '',
  priority = false,
}: {
  src: string | null;
  name: string;
  className?: string;
  priority?: boolean;
}) {
  return (
    <div className={`plant-image ${className}`}>
      {src ? (
        <Image
          src={src}
          alt={name}
          fill
          sizes="(max-width: 700px) 90vw, 500px"
          unoptimized={src.startsWith('/api/')}
          priority={priority}
        />
      ) : (
        <Leaf size={40} aria-hidden="true" />
      )}
    </div>
  );
}
const colors: Record<HealthState, string> = {
  healthy: 'var(--chlorophyll)',
  watch: 'var(--watch)',
  attention: 'var(--saffron)',
  critical: 'var(--critical)',
  baseline: 'var(--muted)',
};
export function Vitality({
  score,
  size = 112,
  label = false,
  distribution,
}: {
  score: number | null;
  size?: number;
  label?: boolean;
  distribution?: {
    healthy: number;
    watch: number;
    attention: number;
    critical: number;
    baseline?: number;
  };
}) {
  const { t } = useLocale(),
    state = healthState(score);
  let offset = 0;
  const total = distribution ? Object.values(distribution).reduce((a, b) => a + b, 0) : 0;
  return (
    <div
      className="vitality"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`${t('Health')}: ${score ?? t('Baseline')}${score === null ? '' : ' / 100'}`}
    >
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <circle
          cx="60"
          cy="60"
          r="51"
          fill="none"
          stroke="currentColor"
          opacity=".12"
          strokeWidth="11"
        />
        {distribution && total ? (
          Object.entries(distribution)
            .filter(([, count]) => count > 0)
            .map(([s, count]) => {
              const length = (count / total) * 320;
              const o = offset;
              offset += length;
              return (
                <circle
                  key={s}
                  cx="60"
                  cy="60"
                  r="51"
                  fill="none"
                  stroke={colors[s as HealthState]}
                  strokeWidth="11"
                  strokeLinecap="round"
                  strokeDasharray={`${Math.max(0, length - 5)} 320`}
                  strokeDashoffset={-o}
                  transform="rotate(-90 60 60)"
                />
              );
            })
        ) : (
          <circle
            className="vitality-arc"
            cx="60"
            cy="60"
            r="51"
            fill="none"
            stroke={colors[state]}
            strokeWidth="9"
            strokeLinecap="round"
            strokeDasharray={`${((score ?? 0) / 100) * 320} 320`}
            transform="rotate(-90 60 60)"
          />
        )}
      </svg>
      <div>
        <strong>{score ?? '—'}</strong>
        {label && <small>{t('Average vitality')}</small>}
      </div>
    </div>
  );
}
export function TrendChart({
  points,
  height = 150,
}: {
  points: { score: number; label: string }[];
  height?: number;
}) {
  const { t } = useLocale();
  if (!points.length) return <div className="empty compact">{t('Building a baseline')}</div>;
  const values = points.map(
    (p, i) => `${40 + (i / Math.max(1, points.length - 1)) * 660},${160 - p.score * 1.3}`,
  );
  return (
    <figure className="trend-chart" dir="ltr">
      <svg
        viewBox="0 0 720 190"
        style={{ height }}
        role="img"
        aria-label={points.map((p) => `${p.label}: ${p.score}`).join(', ')}
      >
        {[0, 25, 50, 75, 100].map((n) => (
          <g key={n}>
            <line x1="40" x2="700" y1={160 - n * 1.3} y2={160 - n * 1.3} stroke="var(--border)" />
            <text x="0" y={164 - n * 1.3} fill="var(--muted)" fontSize="11">
              {n}
            </text>
          </g>
        ))}
        <polygon
          points={`40,160 ${values.join(' ')} 700,160`}
          fill="var(--chlorophyll)"
          opacity=".13"
        />
        <polyline
          points={values.join(' ')}
          fill="none"
          stroke="var(--success)"
          strokeWidth="2.4"
          strokeLinejoin="round"
        />
        {points.map((p, i) => (
          <circle
            key={i}
            cx={40 + (i / Math.max(1, points.length - 1)) * 660}
            cy={160 - p.score * 1.3}
            r="4"
            fill="var(--success)"
          />
        ))}
      </svg>
      <figcaption>
        {points.map((p, i) => (
          <span key={i}>{p.label}</span>
        ))}
      </figcaption>
    </figure>
  );
}
export function Dialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    id = useId(),
    { t } = useLocale();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    ref.current?.showModal();
    return () => {
      previous?.focus();
    };
  }, []);
  return (
    <dialog ref={ref} className="sheet" aria-labelledby={id} onCancel={onClose}>
      <header>
        <h2 id={id}>{title}</h2>
        <button className="icon-button" onClick={onClose} aria-label={t('Close')}>
          <X size={20} />
        </button>
      </header>
      {children}
    </dialog>
  );
}
export function ErrorMessage({ message }: { message: string | null }) {
  return message ? (
    <p className="error-message" role="alert">
      {message}
    </p>
  ) : null;
}
export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="empty">
      <Leaf aria-hidden="true" />
      <h2>{title}</h2>
      {children}
    </div>
  );
}
