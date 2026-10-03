import type { VisionFeatures, HealthSnapshot, HealthReason } from '../types';
export const ENGINE_VERSION = 'vitality/1.2';
export interface HealthInput {
  current: VisionFeatures;
  analysisId: string;
  previous: { features: VisionFeatures; id: string }[];
  previousScore: number | null;
  lastWatered: Date | null;
  lastFertilised: Date | null;
  lastMoved: Date | null;
  wateringDays: number;
  fertilisingDays: number;
  now: Date;
  observedAt?: Date;
}
export function calculateHealth(input: HealthInput): HealthSnapshot {
  const { current: c, previous, analysisId } = input;
  const baseline = previous.length
    ? previous.reduce((sum, p) => sum + p.features.yellowing_estimate.value, 0) / previous.length
    : null;
  const reasons: HealthReason[] = [];
  const quality = c.image_quality.value;
  const usable = quality >= 0.55 && c.analysis_confidence >= 0.35;
  const imageAge = input.observedAt
    ? Math.max(0, (input.now.getTime() - input.observedAt.getTime()) / 86400000)
    : 0;
  const visual = usable ? c.overall_visual_condition.value * 65 : 32.5;
  const stress = usable
    ? -Math.min(
        20,
        (c.yellowing_estimate.value +
          c.browning_estimate.value +
          c.wilting_signal.value +
          c.visible_damage_signal.value) *
          12,
      )
    : 0;
  const trajectory =
    usable && baseline !== null
      ? -Math.max(-0.1, Math.min(0.5, c.yellowing_estimate.value - baseline)) * 25
      : 0;
  const growth = usable ? c.new_growth_signal.value * c.new_growth_signal.confidence * 8 : 0;
  const mean = (
    key: 'browning_estimate' | 'visible_leaf_loss_estimate' | 'canopy_size_estimate',
  ) =>
    previous.length
      ? previous.reduce((sum, p) => sum + p.features[key].value, 0) / previous.length
      : null;
  const brownBaseline = mean('browning_estimate'),
    lossBaseline = mean('visible_leaf_loss_estimate'),
    canopyBaseline = mean('canopy_size_estimate');
  const browningTrajectory =
    usable && brownBaseline !== null
      ? -Math.max(-0.1, Math.min(0.5, c.browning_estimate.value - brownBaseline)) * 15
      : 0;
  const leafLossTrajectory =
    usable && lossBaseline !== null
      ? -Math.max(0, c.visible_leaf_loss_estimate.value - lossBaseline) *
        20 *
        c.visible_leaf_loss_estimate.confidence
      : 0;
  const canopyTrajectory =
    usable && canopyBaseline !== null
      ? -Math.max(0, canopyBaseline - c.canopy_size_estimate.value) *
        12 *
        c.canopy_size_estimate.confidence
      : 0;
  const waterAge = input.lastWatered
    ? (input.now.getTime() - input.lastWatered.getTime()) / 86400000
    : null;
  const overdue = waterAge !== null && waterAge > input.wateringDays;
  const watering =
    waterAge === null ? 0 : Math.max(-18, 10 - Math.max(0, waterAge - input.wateringDays) * 2);
  const fertAge = input.lastFertilised
    ? (input.now.getTime() - input.lastFertilised.getTime()) / 86400000
    : null;
  const fertilising = fertAge !== null && fertAge < input.fertilisingDays ? 3 : 0;
  const relocation =
    input.lastMoved && input.now.getTime() - input.lastMoved.getTime() < 3 * 86400000 ? -2 : 0;
  const composition = {
    base: 20,
    visual,
    stress,
    trajectory,
    browningTrajectory,
    leafLossTrajectory,
    canopyTrajectory,
    growth,
    watering,
    fertilising,
    relocation,
  };
  const score = Math.max(
    0,
    Math.min(100, Math.round(Object.values(composition).reduce((a, b) => a + b, 0))),
  );
  const delta = input.previousScore === null ? 0 : score - input.previousScore;
  if (!usable)
    reasons.push({
      text: 'The image is not reliable enough for a visual score.',
      action: 'Retake in even daylight with the whole plant visible.',
      sourceId: analysisId,
      kind: 'visual',
    });
  if (baseline !== null && c.yellowing_estimate.value - baseline > 0.08 && usable)
    reasons.push({
      text: 'Yellowing increased compared with comparable observations.',
      action: 'Inspect leaves and soil moisture before changing care.',
      sourceId: analysisId,
      kind: 'visual',
    });
  if (c.wilting_signal.value > 0.3 && usable)
    reasons.push({
      text: 'Visible wilting was observed.',
      action: 'Inspect soil moisture and the growing environment.',
      sourceId: analysisId,
      kind: 'visual',
    });
  if (leafLossTrajectory < -2 || canopyTrajectory < -2)
    reasons.push({
      text: 'The visible canopy or leaf retention decreased across comparable photographs.',
      action: 'Inspect for leaf loss and confirm the same framing in the next observation.',
      sourceId: analysisId,
      kind: 'visual',
    });
  if (overdue)
    reasons.push({
      text: `Last watering was ${Math.floor(waterAge!)} days ago; the check cadence is ${input.wateringDays} days.`,
      action: 'Check soil moisture today. Water only if needed.',
      sourceId: null,
      kind: 'care',
    });
  if (waterAge === null)
    reasons.push({
      text: 'No watering history has been recorded.',
      action: 'Inspect soil moisture and record the next care.',
      sourceId: null,
      kind: 'care',
    });
  if (previous.length < 2)
    reasons.push({
      text: 'Building a baseline. More comparable observations will strengthen the trend.',
      action: 'Capture the same viewpoint in consistent light next week.',
      sourceId: analysisId,
      kind: 'baseline',
    });
  if (imageAge > 21)
    reasons.push({
      text: `The latest visual observation is ${Math.floor(imageAge)} days old.`,
      action: 'Capture a current observation before relying on a visual trend.',
      sourceId: analysisId,
      kind: 'baseline',
    });
  if (
    previous.length >= 3 &&
    usable &&
    c.overall_visual_condition.value < previous[0].features.overall_visual_condition.value - 0.04 &&
    previous[0].features.overall_visual_condition.value <
      previous[1].features.overall_visual_condition.value - 0.04 &&
    previous[1].features.overall_visual_condition.value <
      previous[2].features.overall_visual_condition.value - 0.04
  )
    reasons.push({
      text: 'Visual condition deteriorated repeatedly across comparable observations.',
      action: 'Prioritise an on-site inspection and review recent care.',
      sourceId: analysisId,
      kind: 'visual',
    });
  if (!reasons.length)
    reasons.push({
      text: 'Visual signals are stable against recent comparable observations.',
      action: 'Continue the current care rhythm and observe weekly.',
      sourceId: analysisId,
      kind: 'visual',
    });
  const confidence = Math.min(
    0.95,
    c.analysis_confidence *
      (usable ? 1 : 0.4) *
      (0.5 + Math.min(previous.length, 4) * 0.1) *
      Math.exp(-imageAge / 90),
  );
  return {
    score,
    delta,
    trend:
      previous.length < 2 || !usable || imageAge > 45
        ? 'baseline'
        : delta >= 3
          ? 'improving'
          : delta <= -3
            ? 'declining'
            : 'stable',
    confidence,
    composition,
    reasons,
    engine_version: ENGINE_VERSION,
  };
}
export function warningRules(snapshot: HealthSnapshot, features: VisionFeatures) {
  const rules: {
    rule: string;
    severity: 'watch' | 'attention' | 'critical';
    reason: string;
    action: string;
  }[] = [];
  if (snapshot.score < 50 && snapshot.confidence >= 0.35)
    rules.push({
      rule: 'low-vitality',
      severity: 'critical',
      reason: 'Health signals indicate significant stress.',
      action: 'Inspect this plant today and capture a follow-up observation.',
    });
  if (snapshot.delta <= -10 && snapshot.trend !== 'baseline')
    rules.push({
      rule: 'rapid-decline',
      severity: 'attention',
      reason: `Vitality declined ${Math.abs(snapshot.delta)} points.`,
      action: 'Review recent observations and care before adjusting the routine.',
    });
  if (features.yellowing_estimate.value > 0.3 && features.yellowing_estimate.confidence > 0.5)
    rules.push({
      rule: 'yellowing',
      severity: 'attention',
      reason: 'Yellowing is visible in this observation.',
      action: 'Inspect leaf colour, light exposure and soil moisture.',
    });
  const water = snapshot.reasons.find(
    (r) => r.kind === 'care' && r.text.startsWith('Last watering'),
  );
  if (snapshot.reasons.some((r) => r.text.startsWith('Visual condition deteriorated repeatedly')))
    rules.push({
      rule: 'repeated-deterioration',
      severity: 'attention',
      reason: 'Repeated visual deterioration across comparable observations.',
      action: 'Inspect this plant and review its care history.',
    });
  if (water)
    rules.push({
      rule: 'care-overdue',
      severity: 'watch',
      reason: water.text,
      action: water.action,
    });
  return rules;
}
