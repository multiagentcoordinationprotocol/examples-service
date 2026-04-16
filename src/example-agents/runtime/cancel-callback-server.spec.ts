import { startCancelCallbackServer } from './cancel-callback-server';

async function postJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
}

describe('cancel-callback-server', () => {
  it('invokes the handler when POST hits the configured path', async () => {
    const received: { runId?: string; reason?: string }[] = [];
    const server = await startCancelCallbackServer({
      host: '127.0.0.1',
      port: 0,
      path: '/agent/cancel',
      onCancel: async (body) => {
        received.push(body);
      }
    });
    try {
      const res = await postJson(server.address, { runId: 'run-1', reason: 'user cancel' });
      expect(res.status).toBe(202);
      expect(await res.json()).toEqual({ ok: true });
      expect(received).toEqual([{ runId: 'run-1', reason: 'user cancel' }]);
    } finally {
      await server.close();
    }
  });

  it('returns 404 for other paths', async () => {
    const server = await startCancelCallbackServer({
      host: '127.0.0.1',
      port: 0,
      path: '/agent/cancel',
      onCancel: () => {}
    });
    try {
      const base = server.address.replace('/agent/cancel', '');
      const res = await fetch(`${base}/elsewhere`, { method: 'POST' });
      expect(res.status).toBe(404);
    } finally {
      await server.close();
    }
  });

  it('returns 500 when the handler throws', async () => {
    const server = await startCancelCallbackServer({
      host: '127.0.0.1',
      port: 0,
      path: '/agent/cancel',
      onCancel: async () => {
        throw new Error('downstream failure');
      }
    });
    try {
      const res = await postJson(server.address, { runId: 'run-1' });
      expect(res.status).toBe(500);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain('downstream failure');
    } finally {
      await server.close();
    }
  });

  it('rejects non-JSON bodies with 400', async () => {
    const server = await startCancelCallbackServer({
      host: '127.0.0.1',
      port: 0,
      path: '/agent/cancel',
      onCancel: () => {}
    });
    try {
      const res = await fetch(server.address, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: 'not json'
      });
      expect(res.status).toBe(400);
    } finally {
      await server.close();
    }
  });
});
