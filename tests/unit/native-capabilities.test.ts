import { describe, expect, it, vi } from 'vitest';
import { createWakeLockController } from '../../src/platform/wake-lock';
import { createFileExporter } from '../../src/platform/export-text';

describe('screen wake lock lifecycle', () => {
  function fixture() {
    const release = vi.fn(async () => {});
    const handle = { release, addEventListener: vi.fn() };
    const request = vi.fn(async () => handle);
    const status = vi.fn();
    return { release, handle, request, status, controller: createWakeLockController({ request }, status) };
  }
  it('requests only when wanted and foreground; releases on background and reacquires on resume', async () => {
    const f = fixture();
    await f.controller.update(false, true);
    expect(f.request).not.toHaveBeenCalled();
    await f.controller.update(true, true);
    expect(f.request).toHaveBeenCalledWith('screen');
    await f.controller.update(true, true);
    expect(f.request).toHaveBeenCalledTimes(1);
    await f.controller.update(true, false);
    expect(f.release).toHaveBeenCalledTimes(1);
    await f.controller.update(true, true);
    expect(f.request).toHaveBeenCalledTimes(2);
    await f.controller.dispose();
    expect(f.release).toHaveBeenCalledTimes(2);
  });
  it('releases a late acquisition after training ends', async () => {
    const f = fixture();
    let finish!: (handle: typeof f.handle) => void;
    f.request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const opening = f.controller.update(true, true);
    await vi.waitFor(() => expect(f.request).toHaveBeenCalled());
    const ending = f.controller.update(false, true);
    finish(f.handle);
    await Promise.all([opening, ending]);
    expect(f.release).toHaveBeenCalledTimes(1);
    expect(f.status).not.toHaveBeenCalledWith('on');
  });
  it('handles unsupported and rejected APIs without throwing or falsely reporting on', async () => {
    const status = vi.fn();
    const unavailable = createWakeLockController(undefined, status);
    await unavailable.update(true, true);
    expect(status).toHaveBeenLastCalledWith('unavailable');
    const f = fixture();
    f.request.mockRejectedValueOnce(new Error('NotAllowedError'));
    await expect(f.controller.update(true, true)).resolves.toBeUndefined();
    expect(f.status).toHaveBeenLastCalledWith('unavailable');
    await f.controller.update(true, true);
    expect(f.status).toHaveBeenLastCalledWith('on');
    await f.controller.dispose();
  });
  it('reports an OS release and retries only at the next explicit update', async () => {
    const f = fixture();
    await f.controller.update(true, true);
    f.handle.addEventListener.mock.calls[0][1]();
    expect(f.status).toHaveBeenLastCalledWith('off');
    expect(f.request).toHaveBeenCalledTimes(1);
    await f.controller.update(true, true);
    expect(f.request).toHaveBeenCalledTimes(2);
  });
});

describe('native text-file sharing', () => {
  const file = { name: '健力宝备份-2026-10-17.json', text: '{"schemaVersion":1,"name":"训练"}', type: 'application/json;charset=utf-8' };
  function fixture(native = true) {
    const port = { write: vi.fn(async () => ({ uri: 'file:///cache/export.json' })), remove: vi.fn(async () => {}), share: vi.fn(async () => {}) };
    const load = vi.fn(async () => port), download = vi.fn();
    return { port, load, download, export: createFileExporter({ native: () => native, load, download }) };
  }
  it('keeps Web download bytes/type/name exact and does not load native plugins', async () => {
    const f = fixture(false);
    expect(await f.export(file)).toBe('downloaded');
    expect(f.download).toHaveBeenCalledWith(file);
    expect(f.load).not.toHaveBeenCalled();
  });
  it('writes exact UTF-8 text into an isolated temporary file, shares its URI, then cleans it', async () => {
    const f = fixture();
    expect(await f.export(file)).toBe('shared');
    const path = f.port.write.mock.calls[0][0];
    expect(path).toMatch(/^exports\/[\w-]+-健力宝备份-2026-10-17.json$/);
    expect(f.port.write).toHaveBeenCalledWith(path, file.text);
    expect(f.port.share).toHaveBeenCalledWith('file:///cache/export.json', file.name);
    expect(f.port.remove).toHaveBeenCalledWith(path);
    expect(f.download).not.toHaveBeenCalled();
  });
  it('returns cancellation separately and still cleans the temporary file', async () => {
    const f = fixture();
    f.port.share.mockRejectedValueOnce(new Error('Share canceled'));
    expect(await f.export(file)).toBe('cancelled');
    expect(f.port.remove).toHaveBeenCalledTimes(1);
  });
  it('propagates actual sharing failures without pretending to download and permits retry', async () => {
    const f = fixture();
    f.port.write.mockRejectedValueOnce(new Error('disk full'));
    await expect(f.export(file)).rejects.toThrow('disk full');
    expect(f.port.share).not.toHaveBeenCalled();
    expect(f.download).not.toHaveBeenCalled();
    expect(await f.export(file)).toBe('shared');
    f.port.share.mockRejectedValueOnce(new Error('bridge failure'));
    await expect(f.export(file)).rejects.toThrow('bridge failure');
    expect(f.port.remove).toHaveBeenCalledTimes(2);
  });
  it('prevents overlapping share sheets and does not erase a success on cleanup failure', async () => {
    const f = fixture();
    let finish!: () => void;
    f.port.share.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = f.export(file);
    await vi.waitFor(() => expect(f.port.share).toHaveBeenCalled());
    expect(await f.export(file)).toBe('busy');
    f.port.remove.mockRejectedValueOnce(new Error('cleanup denied'));
    finish();
    expect(await pending).toBe('shared');
    expect(await f.export(file)).toBe('shared');
  });
  it('rejects traversal in file names without native writes', async () => {
    const f = fixture();
    await expect(f.export({ ...file, name: '../main.json' })).rejects.toThrow();
    expect(f.port.write).not.toHaveBeenCalled();
  });
});
