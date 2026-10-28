import { createServer, request, type ClientRequest } from 'node:http';
import { pipeline } from 'node:stream';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { listenForBrowser } from './helpers';

type Failure = 'html' | 'not-found' | 'truncated';

/** WebKit's native media loader bypasses page.route. Faults must reach HTTP. */
export async function referenceNetwork(upstream: string, paths?: readonly string[]) {
  const target = new URL(upstream);
  if (target.protocol !== 'http:' || target.hostname !== '127.0.0.1')
    throw new Error('Reference fault fixture only permits the local preview');
  let failure: Failure | undefined = 'html';
  const failures: { path: string; status: number; bytes: number }[] = [];
  const pending = new Set<ClientRequest>();
  const server = createServer((req, res) => {
    const destination = new URL(req.url ?? '/', target);
    if (destination.origin !== target.origin) {
      res.writeHead(400); res.end(); return;
    }
    const path = destination.pathname;
    const mode = failure;
    if (mode && path.startsWith('/exercise-media/') && (!paths || paths.includes(path))) {
      void (async () => {
        const body = mode === 'truncated' && path.endsWith('.mp4')
          ? (await readFile(resolve('dist', `.${path}`))).subarray(0, 48)
          : Buffer.from('<html>fallback</html>');
        const status = mode === 'not-found' ? 404 : 200;
        failures.push({ path, status, bytes: body.length });
        res.writeHead(status, {
          'Content-Type': path.endsWith('.png') ? 'image/png' : 'video/mp4',
          'Content-Length': body.length, 'Cache-Control': 'no-store',
        });
        res.end(body);
      })().catch(() => { res.writeHead(500); res.end(); });
      return;
    }
    const remote = request(destination, {
      method: req.method, headers: { ...req.headers, host: target.host },
    }, response => {
      res.writeHead(response.statusCode ?? 502, response.headers);
      pipeline(response, res, () => {});
    });
    pending.add(remote);
    remote.on('close', () => pending.delete(remote));
    remote.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    res.on('close', () => remote.destroy());
    remote.end();
  });
  const origin = await listenForBrowser(server);
  return {
    origin, failures,
    setFailure(mode?: Failure) { failure = mode; },
    async close() {
      for (const remote of pending) remote.destroy();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
  };
}
