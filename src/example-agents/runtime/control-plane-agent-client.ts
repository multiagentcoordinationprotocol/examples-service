type JsonRecord = Record<string, unknown>;

export interface AgentRuntimeContext {
  runId: string;
  traceId?: string;
  scenarioRef: string;
  modeName: string;
  modeVersion: string;
  configurationVersion: string;
  policyVersion?: string;
  ttlMs: number;
  initiatorParticipantId?: string;
  participantId: string;
  role: string;
  framework: string;
  agentRef: string;
  participants: string[];
  sessionContext: JsonRecord;
}

export interface CanonicalEvent {
  seq: number;
  type: string;
  subject?: {
    kind?: string;
    id?: string;
  };
  data?: JsonRecord;
}

export interface RunRecord {
  id: string;
  status: string;
  runtimeSessionId?: string;
  metadata?: JsonRecord;
}

function readEnv(name: string, defaultValue?: string): string {
  const value = process.env[name] ?? defaultValue;
  if (value === undefined) {
    throw new Error(`missing required environment variable: ${name}`);
  }
  return value;
}

export function parseJsonRecord(raw: string | undefined): JsonRecord {
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as JsonRecord;
    }
  } catch {
    // fall through to empty object
  }

  return {};
}

export function parseStringArray(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter((value): value is string => typeof value === 'string');
    }
  } catch {
    // fall through to empty list
  }

  return [];
}

export function loadAgentRuntimeContext(): AgentRuntimeContext {
  return {
    runId: readEnv('EXAMPLE_AGENT_RUN_ID'),
    traceId: process.env.EXAMPLE_AGENT_TRACE_ID,
    scenarioRef: readEnv('EXAMPLE_AGENT_SCENARIO_REF'),
    modeName: readEnv('EXAMPLE_AGENT_MODE_NAME'),
    modeVersion: readEnv('EXAMPLE_AGENT_MODE_VERSION', '1.0.0'),
    configurationVersion: readEnv('EXAMPLE_AGENT_CONFIGURATION_VERSION', 'config.default'),
    policyVersion: process.env.EXAMPLE_AGENT_POLICY_VERSION,
    ttlMs: Number(readEnv('EXAMPLE_AGENT_SESSION_TTL_MS', '300000')),
    initiatorParticipantId: process.env.EXAMPLE_AGENT_INITIATOR_PARTICIPANT_ID,
    participantId: readEnv('EXAMPLE_AGENT_PARTICIPANT_ID'),
    role: readEnv('EXAMPLE_AGENT_ROLE'),
    framework: readEnv('EXAMPLE_AGENT_FRAMEWORK'),
    agentRef: readEnv('EXAMPLE_AGENT_REF'),
    participants: parseStringArray(process.env.EXAMPLE_AGENT_PARTICIPANTS_JSON),
    sessionContext: parseJsonRecord(process.env.EXAMPLE_AGENT_CONTEXT_JSON)
  };
}

export class ControlPlaneAgentClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly authorization: string;

  constructor() {
    this.baseUrl = readEnv('CONTROL_PLANE_BASE_URL').replace(/\/$/, '');
    this.timeoutMs = Number(readEnv('CONTROL_PLANE_TIMEOUT_MS', '10000'));
    const apiKey = process.env.CONTROL_PLANE_API_KEY?.trim() || 'example-agent';
    this.authorization = apiKey.startsWith('Bearer ') ? apiKey : `Bearer ${apiKey}`;
  }

  async getRun(runId: string): Promise<RunRecord> {
    return this.request<RunRecord>('GET', `/runs/${runId}`);
  }

  async getEvents(runId: string, afterSeq: number, limit = 200): Promise<CanonicalEvent[]> {
    return this.request<CanonicalEvent[]>('GET', `/runs/${runId}/events?afterSeq=${afterSeq}&limit=${limit}`);
  }

  async sendMessage(runId: string, body: JsonRecord): Promise<JsonRecord> {
    return this.request<JsonRecord>('POST', `/runs/${runId}/messages`, body);
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
        throw new Error(`${method} ${path} failed (${response.status}): ${text}`);
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

export function buildProtoEnvelope(typeName: string, value: JsonRecord): JsonRecord {
  return {
    encoding: 'proto',
    proto: {
      typeName,
      value
    }
  };
}

export function extractProposalId(event: CanonicalEvent): string | undefined {
  const data = event.data ?? {};
  const payload = (data.decodedPayload as JsonRecord | undefined) ?? (data.payload as JsonRecord | undefined) ?? {};
  const proposalId = payload.proposalId ?? payload.proposal_id ?? event.subject?.id;
  return typeof proposalId === 'string' ? proposalId : undefined;
}

export function extractMessageType(event: CanonicalEvent): string | undefined {
  const messageType = event.data?.messageType;
  return typeof messageType === 'string' ? messageType : undefined;
}

export function extractSender(event: CanonicalEvent): string | undefined {
  const sender = event.data?.sender;
  return typeof sender === 'string' ? sender : undefined;
}

export function extractDecodedPayload(event: CanonicalEvent): JsonRecord {
  const data = event.data ?? {};
  const payload = (data.decodedPayload as JsonRecord | undefined) ?? (data.payload as JsonRecord | undefined) ?? {};
  return payload;
}

export function logAgent(message: string, details?: JsonRecord): void {
  const payload = details
    ? { ts: new Date().toISOString(), message, ...details }
    : { ts: new Date().toISOString(), message };
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}
