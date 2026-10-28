import { describe, expect, it, vi } from 'vitest';
import { readStorageInfo, requestStorageProtection } from '../../src/pwa/storage';
import { pageFromHash } from '../../src/app/navigation';
describe('PWA storage and navigation', () => {
  it('reads optional estimated usage without treating it as a guarantee', async () => {
    expect(await readStorageInfo({ persisted: async () => true, estimate: async () => ({ usage: 20, quota: 100 }) })).toMatchObject({ persisted: true, usage: 20, quota: 100 });
  });
  it('absent, rejected and malformed storage APIs are safe', async () => {
    expect((await readStorageInfo(undefined)).persisted).toBe(null);
    expect((await readStorageInfo({ persisted: async () => { throw Error('privacy'); }, estimate: async () => ({ usage: NaN, quota: -1 }) })).usage).toBe(null);
  });
  it('persistence refusal, rejection and unavailability are distinct retryable outcomes', async () => {
    expect(await requestStorageProtection(undefined)).toBe('unsupported');
    expect(await requestStorageProtection({ persist: async () => false })).toBe('denied');
    expect(await requestStorageProtection({ persist: async () => true })).toBe('granted');
    expect(await requestStorageProtection({ persist: async () => { throw Error('not allowed'); } })).toBe('failed');
  });
  it('offline-management deep links retain existing page routes and reject unknown pages', () => {
    expect(pageFromHash('#/exercises?offline=1')).toBe('exercises');
    expect(pageFromHash('#/workout')).toBe('workout'); expect(pageFromHash('#/settings')).toBe('settings'); expect(pageFromHash('#/unknown?offline=1')).toBe('today');
  });
  it('a hanging storage permission request has a deadline', async () => {
    vi.useFakeTimers();
    try { const pending = requestStorageProtection({ persist: () => new Promise(() => {}) }); await vi.advanceTimersByTimeAsync(15001); expect(await pending).toBe('failed'); }
    finally { vi.useRealTimers(); }
  });
  it('synchronous permission rejection leaves no timer behind', async () => {
    vi.useFakeTimers();
    try { expect(await requestStorageProtection({ persist: () => { throw Error('blocked synchronously'); } })).toBe('failed'); expect(vi.getTimerCount()).toBe(0); }
    finally { vi.useRealTimers(); }
  });
});
