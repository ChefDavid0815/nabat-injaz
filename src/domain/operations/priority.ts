export interface PriorityEvidence {
  score: number | null;
  delta: number | null;
  confidence: number | null;
  severity: string | null;
  overdueDays: number;
  inspectionDays: number;
  criticalLocation?: boolean;
  scheduledWork?: boolean;
  visualStress?: number;
  visualConfidence?: number;
}
export function explainPriority(e: PriorityEvidence) {
  const parts: { reason: string; weight: number }[] = [];
  const severity = { critical: 50, attention: 30, watch: 12 }[e.severity || ''] || 0;
  if (severity) parts.push({ reason: `${e.severity} alert`, weight: severity });
  if (e.delta !== null && e.delta < 0)
    parts.push({
      reason: `${Math.abs(e.delta)} point decline · ${Math.round((e.confidence ?? 0.5) * 100)}% confidence`,
      weight: Math.min(25, -e.delta) * Math.max(0, Math.min(1, e.confidence ?? 0.5)),
    });
  if (e.overdueDays > 0)
    parts.push({
      reason: `Soil moisture check overdue ${Math.ceil(e.overdueDays)} days`,
      weight: Math.min(20, e.overdueDays) * 2,
    });
  if (e.inspectionDays > 30)
    parts.push({ reason: `No inspection for ${Math.floor(e.inspectionDays)} days`, weight: 8 });
  if (e.criticalLocation) parts.push({ reason: 'Critical operational location', weight: 10 });
  if (e.scheduledWork) parts.push({ reason: 'Scheduled work is due', weight: 6 });
  if ((e.visualStress ?? 0) > 0.2)
    parts.push({
      reason: 'Recent visible stress, confidence-weighted',
      weight: (e.visualStress ?? 0) * (e.visualConfidence ?? 0) * 12,
    });
  if (e.score !== null) parts.push({ reason: `Health ${e.score}`, weight: (100 - e.score) * 0.1 });
  return {
    score: Math.round(parts.reduce((v, p) => v + p.weight, 0) * 10) / 10,
    reasons: parts.map((p) => p.reason),
    components: parts,
  };
}
// Mirrors explainPriority so database pagination and displayed explanations use the same factors.
export const operationsPrioritySql = `(CASE a.severity WHEN 'critical' THEN 50 WHEN 'attention' THEN 30 WHEN 'watch' THEN 12 ELSE 0 END
 + LEAST(25,greatest(0,-coalesce(h.delta,0)))*greatest(0,least(1,coalesce(h.confidence,.5)))
 + LEAST(20,greatest(0,extract(epoch FROM (now()-coalesce(c.last_watered,p.created_at)))/86400-s.watering_days))*2
 + greatest(0,100-coalesce(h.score,100))*.1
 + CASE WHEN coalesce(inspection.at,p.created_at)<now()-interval '30 days' THEN 8 ELSE 0 END
 + CASE WHEN l.critical THEN 10 ELSE 0 END
 + CASE WHEN schedule.due THEN 6 ELSE 0 END
 + CASE WHEN visual.stress>.2 THEN visual.stress*visual.confidence*12 ELSE 0 END)`;
export function healthState(score: number | null) {
  return score === null
    ? 'baseline'
    : score < 50
      ? 'critical'
      : score < 70
        ? 'attention'
        : score < 80
          ? 'watch'
          : 'healthy';
}
export const alertTransitions: Record<string, string[]> = {
  open: ['acknowledged', 'assigned', 'in_progress', 'resolved'],
  acknowledged: ['assigned', 'in_progress', 'resolved'],
  assigned: ['in_progress', 'resolved'],
  in_progress: ['assigned', 'resolved'],
  resolved: ['reopened'],
  reopened: ['acknowledged', 'assigned', 'in_progress', 'resolved'],
};
