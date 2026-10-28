import { describe, expect, it } from 'vitest';
import { displayWeight, fromWeight } from '../../src/domain/units';

describe('kg storage and display-only weight conversion', () => {
  it.each([0, 0.001, 0.125, 1.25, 20, 72.4, 5000])('preserves the established display results for %s kg', (kg) => {
    expect(displayWeight(kg, 'kg')).toBe(Math.round(kg * 100) / 100);
    expect(displayWeight(kg, 'lb')).toBe(Math.round(kg * 2.2046226218 * 100) / 100);
  });
  it.each([0, 0.001, 0.125, 1.25, 72.123456789, 5000])('does not quantize stored kilograms for %s', (kg) => {
    expect(fromWeight(kg, 'kg')).toBe(kg);
    expect(fromWeight(kg * 2.2046226218, 'lb')).toBeCloseTo(kg, 10);
  });
  it('converts an entered pound value once without display rounding on the storage path', () => {
    const pounds = 154.327123456;
    expect(fromWeight(pounds, 'lb')).toBe(pounds / 2.2046226218);
    expect(fromWeight(pounds, 'lb')).not.toBe(Math.round(fromWeight(pounds, 'lb') * 100) / 100);
  });
});
