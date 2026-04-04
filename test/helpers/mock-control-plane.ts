import * as http from 'node:http';
import { randomUUID } from 'node:crypto';

export interface RecordedRequest {
  method: string;
  path: string;
  headers: http.IncomingHttpHeaders;
  body: unknown;
  timestamp: Date;
}

export type FailureMode =
  | { kind: 'none' }
  | { kind: 'status'; statusCode: number; body?: string }
  | { kind: 'timeout'; delayMs: number }
  | { kind: 'validate-reject'; errors: string[] };

export interface MockControlPlaneOptions {
  requiredBearerToken?: string;
}

export class MockControlPlane {
  private server!: http.Server;
  private _port = 0;
  private _requests: RecordedRequest[] = [];
  private _validateFailure: FailureMode = { kind: 'none' };
  private _createRunFailure: FailureMode = { kind: 'none' };
  private _requiredBearerToken?: string;
  private _runCounter = 0;
  private _pendingTimers: ReturnType<typeof setTimeout>[] = [];

  constructor(options?: MockControlPlaneOptions) {
    this._requiredBearerToken = options?.requiredBearerToken;
  }

  get port(): number {
    return this._port;
  }

  get baseUrl(): string {
    return `http://127.0.0.1:${this._port}`;
  }

  get requests(): readonly RecordedRequest[] {
    return this._requests;
  }

  get validateRequests(): RecordedRequest[] {
    return this._requests.filter((r) => r.path === '/runs/validate');
  }

  get createRunRequests(): RecordedRequest[] {
    return this._requests.filter((r) => r.path === '/runs' && r.method === 'POST');
  }

  setValidateFailure(mode: FailureMode): void {
    this._validateFailure = mode;
  }

  setCreateRunFailure(mode: FailureMode): void {
    this._createRunFailure = mode;
  }

  clearRequests(): void {
    this._requests = [];
  }

  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = http.createServer((req, res) => this.handleRequest(req, res));
      this.server.listen(0, '127.0.0.1', () => {
        const addr = this.server.address() as { port: number };
        this._port = addr.port;
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    for (const timer of this._pendingTimers) {
      clearTimeout(timer);
    }
    this._pendingTimers = [];

    return new Promise((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.closeAllConnections();
      this.server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    let rawBody = '';
    req.on('data', (chunk: Buffer) => {
      rawBody += chunk.toString();
    });
    req.on('end', () => {
      let body: unknown;
      try {
        body = rawBody ? JSON.parse(rawBody) : undefined;
      } catch {
        body = rawBody;
      }

      const path = req.url ?? '/';
      const method = req.method ?? 'GET';

      this._requests.push({
        method,
        path,
        headers: req.headers,
        body,
        timestamp: new Date()
      });

      if (this._requiredBearerToken) {
        const auth = req.headers['authorization'];
        if (!auth || auth !== `Bearer ${this._requiredBearerToken}`) {
          res.writeHead(401, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unauthorized' }));
          return;
        }
      }

      if (method === 'POST' && path === '/runs/validate') {
        this.handleValidate(body, res);
      } else if (method === 'POST' && path === '/runs') {
        this.handleCreateRun(body, res);
      } else {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
      }
    });
  }

  private handleValidate(body: unknown, res: http.ServerResponse): void {
    if (!this.isValidExecutionRequest(body)) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid ExecutionRequest structure' }));
      return;
    }

    const failure = this._validateFailure;
    if (failure.kind === 'none') {
      res.writeHead(204);
      res.end();
    } else if (failure.kind === 'status') {
      res.writeHead(failure.statusCode, { 'content-type': 'application/json' });
      res.end(failure.body ?? JSON.stringify({ error: `Mock failure ${failure.statusCode}` }));
    } else if (failure.kind === 'timeout') {
      const timer = setTimeout(() => {
        res.writeHead(204);
        res.end();
      }, failure.delayMs);
      this._pendingTimers.push(timer);
    } else if (failure.kind === 'validate-reject') {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ errors: failure.errors }));
    }
  }

  private handleCreateRun(body: unknown, res: http.ServerResponse): void {
    if (!this.isValidExecutionRequest(body)) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid ExecutionRequest structure' }));
      return;
    }

    const failure = this._createRunFailure;
    if (failure.kind === 'none') {
      this._runCounter++;
      res.writeHead(201, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          runId: randomUUID(),
          status: 'queued',
          traceId: randomUUID()
        })
      );
    } else if (failure.kind === 'status') {
      res.writeHead(failure.statusCode, { 'content-type': 'application/json' });
      res.end(failure.body ?? JSON.stringify({ error: `Mock failure ${failure.statusCode}` }));
    } else if (failure.kind === 'timeout') {
      const timer = setTimeout(() => {
        res.writeHead(201, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ runId: randomUUID(), status: 'queued', traceId: randomUUID() }));
      }, failure.delayMs);
      this._pendingTimers.push(timer);
    } else if (failure.kind === 'validate-reject') {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ errors: failure.errors }));
    }
  }

  private isValidExecutionRequest(body: unknown): boolean {
    if (!body || typeof body !== 'object') return false;
    const req = body as Record<string, unknown>;
    if (!req.mode || typeof req.mode !== 'string') return false;
    if (!req.session || typeof req.session !== 'object') return false;
    const session = req.session as Record<string, unknown>;
    if (!session.modeName || typeof session.modeName !== 'string') return false;
    if (!Array.isArray(session.participants) || session.participants.length === 0) return false;
    return true;
  }
}
