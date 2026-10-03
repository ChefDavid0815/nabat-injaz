'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Leaf, ArrowRight } from 'lucide-react';
import { useLocale } from './locale';
import { ErrorMessage } from './ui';
import { mutate } from '@/lib/client';
import type { Location, Species } from '@/domain/types';
export function PlantForm({
  org,
  catalog,
  onCreated,
}: {
  org: string;
  catalog: { species: Species[]; locations: Location[] };
  onCreated?: (plant: { id: string; code: string }) => void;
}) {
  const router = useRouter(),
    { t } = useLocale(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    try {
      const plant = await mutate<{ id: string; code: string }>(`/api/workspaces/${org}/plants`, {
        name: form.get('name'),
        speciesId: form.get('species'),
        locationId: form.get('location') || null,
        origin: form.get('origin') || '',
        acquiredAt: form.get('acquired') || null,
        ageMonthsEstimate: form.get('age') ? Number(form.get('age')) : null,
        publicPassport: form.get('public') === 'on',
      });
      if (onCreated) onCreated(plant);
      else {
        router.push(`/app/plants/${plant.id}?new=true`);
        router.refresh();
      }
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <form className="plant-form" onSubmit={submit}>
      <div className="form-intro">
        <span className="round-icon">
          <Leaf size={28} />
        </span>
        <h1>An identity begins.</h1>
        <p>The name can change. The history stays with the plant.</p>
      </div>
      <label>
        {t('Plant name')}
        <input name="name" required maxLength={120} placeholder="e.g. Monstera by the window" />
      </label>
      <div className="form-grid">
        <label>
          {t('Species')}
          <select name="species" required defaultValue="">
            <option value="" disabled>
              Choose species
            </option>
            {catalog.species.map((s) => (
              <option key={s.id} value={s.id}>
                {s.common_name}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('Location')}
          <select name="location" defaultValue="">
            <option value="">Unplaced</option>
            {catalog.locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="form-grid">
        <label>
          {t('Origin')}
          <input name="origin" maxLength={250} placeholder="Nursery, gift or propagation" />
        </label>
        <label>
          Acquired on
          <input type="date" name="acquired" />
        </label>
      </div>
      <label className="checkbox-inline">
        <input name="public" type="checkbox" defaultChecked />
        {t('Public plant passport')}
      </label>
      <label>
        Estimated age at entry (months)
        <input
          name="age"
          type="number"
          min="0"
          max="3000"
          inputMode="numeric"
          placeholder="Optional, if known"
        />
      </label>
      <p className="helper">
        A tap can show this plant’s name, code and species. Photos, location, health and care remain
        private.
      </p>
      <ErrorMessage message={error} />
      <button className="button full" disabled={busy}>
        {busy ? t('Loading…') : t('Add plant')}
        <ArrowRight size={18} />
      </button>
    </form>
  );
}
