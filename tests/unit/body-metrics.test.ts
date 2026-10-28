import { describe, expect, it } from 'vitest';
import {
  bodySeries,
  latestBodyValue,
  parseBodyForm,
  putBodyMetric,
  removeBodyMetric,
} from '../../src/domain/body-metrics';
import type { BodyMetric } from '../../src/domain/types';
const a: BodyMetric = { id: 'a', date: '2026-10-16', weightKg: 70, measurements: { waist: 80 } };
const b: BodyMetric = { id: 'b', date: '2026-10-18', bodyFatPct: 18 };
describe('body metrics', () => {
  it('parses optional fields without zero fabrication, trims notes and converts pounds once', () => {
    const result = parseBodyForm(
      { date: '2026-10-18', weight: '154.323583526', bodyFat: '', waist: '80.5', note: ' 晨间 ' },
      'lb',
      'a',
    );
    expect(result.errors).toEqual({});
    expect(result.record?.weightKg).toBeCloseTo(70, 8);
    expect(result.record?.measurements).toEqual({ waist: 80.5 });
    expect(result.record?.note).toBe('晨间');
    expect(result.record).not.toHaveProperty('bodyFatPct');
  });
  it.each([
    { date: '2026-02-30', waist: '80' },
    { date: '2026-10-18' },
    { date: '2026-10-18', weight: '-1' },
    { date: '2026-10-18', bodyFat: '101' },
    { date: '2026-10-18', arm: 'NaN' },
  ])('returns actionable errors without a record for %j', (input) => {
    const parsed = parseBodyForm(input, 'kg', 'a');
    expect(Object.keys(parsed.errors).length).toBeGreaterThan(0);
    expect(parsed.record).toBeUndefined();
  });
  it('adds, edits with stable ID, and deletes only the selected observation', () => {
    const input = [a, b],
      before = structuredClone(input);
    const edited = { ...a, date: '2026-10-17', weightKg: 71 };
    expect(putBodyMetric(input, edited, a)).toEqual([edited, b]);
    expect(removeBodyMetric(input, a)).toEqual([b]);
    expect(input).toEqual(before);
  });
  it('rejects duplicate dates, stale editing and removal of changed observations', () => {
    expect(() => putBodyMetric([a], { ...b, date: a.date })).toThrow('日期');
    expect(() => putBodyMetric([{ ...a, weightKg: 75 }], { ...a, weightKg: 71 }, a)).toThrow('变化');
    expect(() => removeBodyMetric([{ ...a, weightKg: 75 }], a)).toThrow('变化');
    expect(() => putBodyMetric([], { ...a, weightKg: 71 }, a)).toThrow('变化');
  });
  it('sorts only actual measurements and retains real zero body fat, without imputing missing days', () => {
    const c = { id: 'c', date: '2026-10-17', weightKg: 72, bodyFatPct: 0 };
    expect(bodySeries([b, c, a], 'weight', 'kg')).toEqual([
      { date: a.date, value: 70 },
      { date: c.date, value: 72 },
    ]);
    expect(bodySeries([b, c, a], 'bodyFat', 'kg', '2026-10-17', '2026-10-17')).toEqual([{ date: c.date, value: 0 }]);
    expect(latestBodyValue([b, c, a], 'weight', 'lb')).toEqual({ date: c.date, value: 158.73 });
    expect(latestBodyValue([], 'waist', 'kg')).toBeUndefined();
  });
});
