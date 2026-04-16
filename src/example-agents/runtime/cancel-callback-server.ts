import * as http from 'node:http';

export interface CancelCallbackOptions {
  host: string;
  port: number;
  path: string;
  onCancel: (body: { runId?: string; reason?: string }) => Promise<void> | void;
}

export interface CancelCallbackServer {
  readonly address: string;
  close(): Promise<void>;
}

/**
 * Bind a local HTTP server that accepts `POST <path>` with a JSON body
 * `{ runId, reason }` and invokes `onCancel`. Returns the bound address
 * (useful when port=0 to discover the ephemeral port).
 *
 * Per RFC-0001 §7.2 Option A the control-plane POSTs this endpoint when a
 * UI-initiated cancel fires; the agent then forwards the cancel to the
 * runtime via its own gRPC channel.
 */
export function startCancelCallbackServer(options: CancelCallbackOptions): Promise<CancelCallbackServer> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      if (req.method === 'GET' && req.url === '/healthz') {
        res.writeHead(204).end();
        return;
      }
      if (req.method !== 'POST' || !req.url?.startsWith(options.path)) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'not found' }));
        return;
      }
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', async () => {
        let parsed: { runId?: string; reason?: string } = {};
        if (chunks.length > 0) {
          try {
            parsed = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
          } catch {
            res.writeHead(400, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: 'invalid json' }));
            return;
          }
        }
        try {
          await options.onCancel(parsed);
          res.writeHead(202, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: message }));
        }
      });
      req.on('error', (error: Error) => {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: error.message }));
      });
    });
    server.on('error', reject);
    server.listen(options.port, options.host, () => {
      const raw = server.address();
      const addr =
        raw && typeof raw === 'object'
          ? `http://${options.host}:${raw.port}${options.path}`
          : `http://${options.host}:${options.port}${options.path}`;
      resolve({
        address: addr,
        close: () =>
          new Promise<void>((resolveClose, rejectClose) => {
            server.close((err) => (err ? rejectClose(err) : resolveClose()));
          })
      });
    });
  });
}
