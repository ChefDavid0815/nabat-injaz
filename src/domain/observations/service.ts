import { database } from '@/server/db';
import { getPlant } from '@/domain/plants/service';
import type { Actor } from '@/domain/types';
export interface TelemetrySignal {
  value: number;
  unit: 'percent' | 'celsius' | 'lux';
  capturedAt: string;
}
export interface ObservationRecord {
  id: string;
  plant_id: string;
  source: 'photo' | 'note' | 'sensor';
  photo_id: string | null;
  metrics: Partial<Record<'soil_moisture' | 'temperature' | 'ambient_light', TelemetrySignal>>;
  note: string;
  captured_at: string;
}
export async function observations(actor: Actor, plantId: string) {
  const plant = await getPlant(actor, plantId);
  return (
    await (
      await database()
    ).query<ObservationRecord>(
      'SELECT id,plant_id,source,photo_id,metrics,note,captured_at FROM observations WHERE plant_id=$1 AND organisation_id=$2 ORDER BY captured_at DESC LIMIT 100',
      [plantId, plant.organisation_id],
    )
  ).rows;
}
