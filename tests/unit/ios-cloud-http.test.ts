import { describe, expect, it, vi } from 'vitest';
import { createNativeCloudRequest, NATIVE_CLOUD_URL } from '../../src/sync/network';
const request = (signal = new AbortController().signal) => ({ method: 'PUT', headers: { Authorization: 'Bearer private-capability' }, body: '{"ciphertext":"opaque"}', signal });
describe('native cloud HTTP boundary', () => {
  it('uses only the fixed HTTPS endpoint, disables redirects and preserves ciphertext/versions', async () => {
    const http = { request: vi.fn(async () => ({ status: 200, url: NATIVE_CLOUD_URL, headers: { 'Content-Type': 'application/json', 'X-Jianlibao-Revision': '"abc"' }, data: { saved: true } })) };
    const response = await createNativeCloudRequest(async () => ({ http }))(request());
    expect(http.request).toHaveBeenCalledWith(expect.objectContaining({ url: NATIVE_CLOUD_URL, method: 'PUT', disableRedirects: true, connectTimeout: 20000, readTimeout: 20000, data: '{"ciphertext":"opaque"}' }));
    expect(response.headers.get('X-Jianlibao-Revision')).toBe('"abc"'); expect(await response.json()).toEqual({ saved: true });
  });
  it('does not dispatch an already-aborted request', async () => {
    const controller = new AbortController(); controller.abort(); const load = vi.fn();
    await expect(createNativeCloudRequest(load)(request(controller.signal))).rejects.toThrow(); expect(load).not.toHaveBeenCalled();
  });
  it('rejects on abort and ignores a late native completion', async () => {
    let resolve!: (value: { status: number; url: string; headers: {}; data: string }) => void;
    const http = { request: vi.fn(() => new Promise<{ status: number; url: string; headers: {}; data: string }>(r => { resolve = r; })) };
    const controller = new AbortController(), pending = createNativeCloudRequest(async () => ({ http }))(request(controller.signal));
    await vi.waitFor(() => expect(http.request).toHaveBeenCalled()); controller.abort();
    await expect(pending).rejects.toThrow(); resolve({ status: 200, url: NATIVE_CLOUD_URL, headers: {}, data: '{}' });
  });
  it.each([302, 307])('rejects a %i redirect without following or forwarding a key', async status => {
    const http = { request: vi.fn(async () => ({ status, url: NATIVE_CLOUD_URL, headers: { Location: 'https://other.example' }, data: '' })) };
    await expect(createNativeCloudRequest(async () => ({ http }))(request())).rejects.toThrow(/跳转/); expect(http.request).toHaveBeenCalledTimes(1);
  });
  it('rejects an unexpected response URL and preserves native errors', async () => {
    const http = { request: vi.fn(async () => ({ status: 200, url: 'https://other.example', headers: {}, data: '{}' })) };
    await expect(createNativeCloudRequest(async () => ({ http }))(request())).rejects.toThrow(/地址/);
    http.request.mockRejectedValueOnce(new Error('native offline'));
    await expect(createNativeCloudRequest(async () => ({ http }))(request())).rejects.toThrow('native offline');
  });
});
