export type Role = 'owner' | 'admin' | 'manager' | 'caretaker' | 'viewer';
export type HealthState = 'healthy' | 'watch' | 'attention' | 'critical' | 'baseline';
export type CareType = 'watered' | 'fertilised' | 'repotted' | 'moved' | 'inspected' | 'assigned';
export interface Actor {
  id: string;
  email: string;
  name: string;
}
export interface Workspace {
  id: string;
  name: string;
  kind: 'personal' | 'business';
  plan: 'personal' | 'pro' | 'business';
  ai_tier?: import('./analysis/routing').AiTier;
  timezone: string;
  role: Role;
}
export interface Species {
  id: string;
  common_name: string;
  scientific_name: string;
  light: string;
  temperature_min: number;
  temperature_max: number;
  watering_days: number;
  fertilising_days: number;
  guidance: string;
}
export interface Location {
  id: string;
  name: string;
  parent_id: string | null;
}
export interface Plant {
  priority_score: number;
  priority_reasons: string[];
  id: string;
  organisation_id: string;
  code: string;
  name: string;
  species_id: string;
  species_name: string;
  scientific_name: string;
  location_id: string | null;
  location_name: string | null;
  origin: string;
  acquired_at: string | null;
  age_months_estimate: number | null;
  created_at: string;
  public_passport: boolean;
  demo_image: string | null;
  image: string | null;
  score: number | null;
  delta: number | null;
  confidence: number | null;
  trend: string | null;
  reasons: HealthReason[] | null;
  last_watered: string | null;
  last_serviced: string | null;
  watering_days: number;
  alert_reason: string | null;
  alert_severity: string | null;
  active_alerts: number;
  tag_token: string | null;
  assignee_id: string | null;
  assignee_name: string | null;
}
export interface HealthReason {
  text: string;
  action: string;
  sourceId: string | null;
  kind: 'visual' | 'care' | 'baseline';
}
export interface TimelineItem {
  id: string;
  type: string;
  at: string;
  note: string;
  actor: string | null;
  image?: string;
  status?: string;
  features?: VisionFeatures;
}
export interface Alert {
  id: string;
  plant_id: string;
  name: string;
  code: string;
  location_name: string | null;
  severity: string;
  reason: string;
  recommended_action: string;
  status: string;
  created_at: string;
  source_id: string | null;
}
export const signalNames = [
  'overall_visual_condition',
  'green_leaf_ratio',
  'yellowing_estimate',
  'browning_estimate',
  'visible_leaf_loss_estimate',
  'canopy_size_estimate',
  'new_growth_signal',
  'wilting_signal',
  'visible_damage_signal',
  'image_quality',
] as const;
export type SignalName = (typeof signalNames)[number];
export interface Signal {
  value: number;
  confidence: number;
  evidence: string;
}
export type VisionFeatures = Record<SignalName, Signal> & {
  evidence_regions?: {
    label: string;
    x: number;
    y: number;
    width: number;
    height: number;
    confidence: number;
  }[];
  analysis_confidence: number;
  evidence_summary: string;
  comparable: boolean;
};
export interface HealthSnapshot {
  score: number;
  delta: number;
  trend: 'baseline' | 'improving' | 'stable' | 'declining';
  confidence: number;
  composition: Record<string, number>;
  reasons: HealthReason[];
  engine_version: string;
}
export const healthState = (score: number | null): HealthState =>
  score === null
    ? 'baseline'
    : score >= 80
      ? 'healthy'
      : score >= 70
        ? 'watch'
        : score >= 50
          ? 'attention'
          : 'critical';
