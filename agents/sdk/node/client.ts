import { BootstrapContext } from './bootstrap';

type JsonRecord = Record<string, unknown>;

export interface CanonicalEvent {
  seq: number;
  type: string;
  subject?: { kind?: string; id?: string };
  data?: JsonRecord;
}

export interface RunRecord {
  id: string;
  status: string;
  runtimeSessionId?: string;
  metadata?: JsonRecord;
}

export const POLICY_EVENT_TYPES = {
  RESOLVED: 'policy.resolved',
  COMMITMENT_EVALUATED: 'policy.commitment.evaluated',
  DENIED: 'policy.denied'
} as const;

export function isPolicyDenial(event: CanonicalEvent): boolean {
  return (
    event.type === POLICY_EVENT_TYPES.DENIED ||
    (event.type === POLICY_EVENT_TYPES.COMMITMENT_EVALUATED && event.data?.decision === 'deny')
  );
}

export class ControlPlaneClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly authorization: string;
  readonly runId: string;
  readonly participantId: string;

  constructor(ctx: BootstrapContext) {
    this.baseUrl = ctx.runtime.baseUrl.replace(/\/$/, '');
    this.timeoutMs = ctx.runtime.timeoutMs ?? 10000;
    const apiKey = (ctx.runtime.apiKey ?? 'example-agent').trim() || 'example-agent';
    this.authorization = apiKey.startsWith('Bearer ') ? apiKey : `Bearer ${apiKey}`;
    this.runId = ctx.run.runId;
    this.participantId = ctx.participant.participantId;
  }

  async getRun(): Promise<RunRecord> {
    return this.request<RunRecord>('GET', `/runs/${this.runId}`);
  }

  async getEvents(afterSeq: number = 0, limit: number = 200): Promise<CanonicalEvent[]> {
    return this.request<CanonicalEvent[]>('GET', `/runs/${this.runId}/events?afterSeq=${afterSeq}&limit=${limit}`);
  }

  async sendMessage(body: JsonRecord): Promise<JsonRecord> {
    return this.request<JsonRecord>('POST', `/runs/${this.runId}/messages`, body);
  }

  isTerminal(run: RunRecord): boolean {
    return ['completed', 'failed', 'cancelled'].includes(run.status);
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: JsonRecord): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          authorization: this.authorization,
          ...(body ? { 'content-type': 'application/json' } : {})
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal
      });

      const text = await response.text();
      if (!response.ok) {
        let reasons: string[] = [];
        let errorMessage = text;
        try {
          const errorBody = JSON.parse(text) as { message?: string; reasons?: string[] };
          errorMessage = errorBody?.message ?? text;
          reasons = errorBody?.reasons ?? [];
        } catch {
          // not JSON
        }
        throw new Error(
          `${method} ${path} failed (${response.status}): ${errorMessage}${reasons.length ? ` [reasons: ${reasons.join(', ')}]` : ''}`
        );
      }
      if (!text) {
        return undefined as T;
      }
      return JSON.parse(text) as T;
    } finally {
      clearTimeout(timer);
    }
  }
}
