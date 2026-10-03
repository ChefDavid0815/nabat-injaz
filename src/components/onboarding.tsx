'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Leaf, Building2, ArrowRight, Check, Camera, Tag } from 'lucide-react';
import { Brand } from './brand';
import { PlantForm } from './plant-form';
import { PhotoCapture } from './photo-capture';
import { ErrorMessage } from './ui';
import { useLocale } from './locale';
import { api, mutate } from '@/lib/client';
import type { Location, Species } from '@/domain/types';
export function Onboarding() {
  const router = useRouter(),
    { t } = useLocale();
  const [kind, setKind] = useState<'personal' | 'business'>('personal'),
    [step, setStep] = useState(1),
    [org, setOrg] = useState(''),
    [catalog, setCatalog] = useState<{ species: Species[]; locations: Location[] }>({
      species: [],
      locations: [],
    }),
    [plant, setPlant] = useState<{ id: string; code: string } | null>(null),
    [photo, setPhoto] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const result = await mutate<{ id: string }>('/api/workspaces', {
        name: form.get('name'),
        kind,
      });
      setOrg(result.id);
      if (form.get('location'))
        await mutate(`/api/workspaces/${result.id}/locations`, { name: form.get('location') });
      const data = await api<typeof catalog>(`/api/workspaces/${result.id}/catalog`);
      setCatalog(data);
      setStep(2);
      setBusy(false);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <main id="main-content" className="onboarding-page">
      <Link href="/">
        <Brand />
      </Link>
      <div className="onboarding-steps">
        <span className={step >= 1 ? 'active' : ''}>Workspace</span>
        <span className={step >= 2 ? 'active' : ''}>First plant</span>
        <span className={step >= 3 ? 'active' : ''}>Into the world</span>
      </div>
      <div className="onboarding-card">
        {step === 1 ? (
          <>
            <h1>A place for your plants.</h1>
            <p>One plant at home, or a whole living collection. Start with a workspace.</p>
            <form onSubmit={create}>
              <div className="workspace-choice" role="radiogroup" aria-label="Workspace type">
                {(['personal', 'business'] as const).map((k) => (
                  <button
                    type="button"
                    role="radio"
                    aria-checked={kind === k}
                    key={k}
                    className={kind === k ? 'selected' : ''}
                    onClick={() => setKind(k)}
                  >
                    {k === 'personal' ? <Leaf size={26} /> : <Building2 size={26} />}
                    <strong>{t(k === 'personal' ? 'Personal' : 'Organisation')}</strong>
                    <span>
                      {k === 'personal'
                        ? 'Your own growing collection.'
                        : 'Shared care across places and people.'}
                    </span>
                  </button>
                ))}
              </div>
              <label>
                {t('Workspace name')}
                <input
                  name="name"
                  required
                  maxLength={120}
                  placeholder={
                    kind === 'personal' ? 'My living collection' : 'Your hotel, school or nursery'
                  }
                />
              </label>
              <label>
                First location
                <input
                  name="location"
                  maxLength={120}
                  placeholder={
                    kind === 'personal' ? 'Living room' : 'Lobby, classroom or courtyard'
                  }
                />
              </label>
              <ErrorMessage message={error} />
              <button className="button full" disabled={busy}>
                {busy ? t('Loading…') : t('Create workspace')}
                <ArrowRight size={18} />
              </button>
            </form>
          </>
        ) : step === 2 ? (
          <PlantForm
            org={org}
            catalog={catalog}
            onCreated={(p) => {
              setPlant(p);
              setStep(3);
            }}
          />
        ) : (
          <>
            <span className="onboarding-success">
              <Check size={32} />
            </span>
            <h1>{t('Your plant is ready to be tagged.')}</h1>
            <p>
              {plant?.code} now has a permanent identity. Add its first observation, then connect it
              to the physical world.
            </p>
            <ol className="provision-steps">
              <li>
                Create plant <Check size={18} />
              </li>
              <li>
                Generate NFC / QR identity <Check size={18} />
              </li>
              <li>Encode or print → Attach → Test tap</li>
            </ol>
            <button className="button secondary full" onClick={() => setPhoto(true)}>
              <Camera size={18} />
              {t('Add observation')}
            </button>
            <button
              className="button full"
              onClick={() => {
                router.push('/app/tags');
                router.refresh();
              }}
            >
              <Tag size={18} />
              Open tag provisioning
            </button>
            <Link className="text-link" href={`/app/plants/${plant?.id}`}>
              Open the living record
              <ArrowRight size={18} />
            </Link>
          </>
        )}
      </div>
      {photo && plant && (
        <PhotoCapture
          plantId={plant.id}
          onClose={() => setPhoto(false)}
          onUploaded={() => setPhoto(false)}
        />
      )}
    </main>
  );
}
