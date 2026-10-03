import { describe, it, expect } from 'vitest';
import { calculateHealth, warningRules, type HealthInput } from '../src/domain/health/engine';
import { signalNames, type VisionFeatures } from '../src/domain/types';
import { visionSchema } from '../src/domain/analysis/contract';
import { DevelopmentVisionProvider } from '../src/domain/analysis/providers';
const features = (yellow = 0.05): VisionFeatures => ({
  ...(Object.fromEntries(
    signalNames.map((key) => [
      key,
      {
        value:
          key === 'overall_visual_condition'
            ? 0.9
            : key === 'image_quality'
              ? 0.95
              : key === 'yellowing_estimate'
                ? yellow
                : 0.1,
        confidence: 0.8,
        evidence: 'Visible evidence',
      },
    ]),
  ) as Record<
    (typeof signalNames)[number],
    { value: number; confidence: number; evidence: string }
  >),
  analysis_confidence: 0.8,
  evidence_summary: 'Stable foliage',
  comparable: true,
});
const input = (): HealthInput => ({
  current: features(),
  analysisId: 'source',
  previous: [
    { features: features(), id: 'old1' },
    { features: features(), id: 'old2' },
  ],
  previousScore: 88,
  lastWatered: new Date('2026-10-01T00:00:00Z'),
  lastFertilised: new Date('2026-09-20T00:00:00Z'),
  lastMoved: null,
  wateringDays: 7,
  fertilisingDays: 30,
  now: new Date('2026-10-03T00:00:00Z'),
});
describe('versioned health engine', () => {
  it('reduces confidence for stale photographs and flags repeated deterioration', () => {
    const i = input();
    i.observedAt = new Date('2026-06-01');
    const stale = calculateHealth(i);
    expect(stale.trend).toBe('baseline');
    expect(stale.confidence).toBeLessThan(0.3);
    i.observedAt = i.now;
    i.current.overall_visual_condition.value = 0.5;
    i.previous = [0.6, 0.7, 0.8].map((value, n) => {
      const f = features();
      f.overall_visual_condition.value = value;
      return { id: String(n), features: f };
    });
    const result = calculateHealth(i);
    expect(warningRules(result, i.current).some((r) => r.rule === 'repeated-deterioration')).toBe(
      true,
    );
  });
  it('keeps new history in baseline state and bounds score/confidence', () => {
    const i = input();
    i.previous = [];
    i.previousScore = null;
    const result = calculateHealth(i);
    expect(result.trend).toBe('baseline');
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.confidence).toBeLessThan(0.8);
    expect(result.reasons.some((r) => r.kind === 'baseline')).toBe(true);
  });
  it('links worsening yellowing to evidence and penalises the trajectory', () => {
    const i = input();
    i.current = features(0.4);
    const score = calculateHealth(i);
    expect(score.composition.trajectory).toBeLessThan(0);
    expect(score.reasons.find((r) => r.text.startsWith('Yellowing'))?.sourceId).toBe('source');
    expect(warningRules(score, i.current).some((r) => r.rule === 'yellowing')).toBe(true);
  });
  it('explains overdue care without making an automatic watering diagnosis', () => {
    const i = input();
    i.lastWatered = new Date('2026-09-01');
    const score = calculateHealth(i);
    expect(score.composition.watering).toBe(-18);
    expect(warningRules(score, i.current).find((r) => r.rule === 'care-overdue')?.action).toContain(
      'only if needed',
    );
  });
  it('does not create a visual trend from poor images', () => {
    const i = input();
    i.current.image_quality.value = 0.2;
    const score = calculateHealth(i);
    expect(score.trend).toBe('baseline');
    expect(score.confidence).toBeLessThan(0.3);
    expect(score.reasons[0].action).toContain('Retake');
  });
  it('rejects out-of-range and unexpected vision fields', () => {
    expect(() => visionSchema.parse({ ...features(), analysis_confidence: 1.5 })).toThrow();
    expect(() => visionSchema.parse({ ...features(), extra: 'injected' })).toThrow();
  });
  it('development provider is deterministic and explicitly synthetic', async () => {
    const p = new DevelopmentVisionProvider(),
      v = { image: Buffer.from('fixture'), mimeType: 'image/jpeg', note: 'test' };
    expect(await p.analyse(v)).toEqual(await p.analyse(v));
    expect((await p.analyse(v)).evidence_summary).toContain('not the condition');
  });
});
