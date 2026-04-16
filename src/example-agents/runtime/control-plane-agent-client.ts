/**
 * Read-only HTTP client used by spawned agents to poll the control-plane for
 * run state and canonical events. Envelope emission MUST go through the
 * MACP SDK directly to the runtime (RFC-MACP-0004 §4 + RFC-MACP-0001 §5.3).
 * The write path to the control-plane has been removed (ES-8); the
 * observer-invariant guard at `src/observer-invariant.spec.ts` fails CI if
 * anyone reintroduces it.
 */
type JsonRecord = Record<string, unknown>;

export interface AgentRuntimeContext {
  runId: string;
  sessionId?: string;
  traceId?: string;
  scenarioRef: string;
  modeName: string;
  modeVersion: string;
  configurationVersion: string;
  policyVersion?: string;
  policyHints?: {
    type?: string;
    description?: string;
    threshold?: number;
    vetoEnabled?: boolean;
    criticalSeverityVetoes?: boolean;
    vetoRoles?: string[];
    vetoThreshold?: number;
    minimumConfidence?: number;
    designatedRoles?: string[];
  };
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
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- empty string must fall through to MACP_SESSION_ID
    sessionId: process.env.EXAMPLE_AGENT_SESSION_ID || process.env.MACP_SESSION_ID,
    traceId: process.env.EXAMPLE_AGENT_TRACE_ID,
    scenarioRef: readEnv('EXAMPLE_AGENT_SCENARIO_REF'),
    modeName: readEnv('EXAMPLE_AGENT_MODE_NAME'),
    modeVersion: readEnv('EXAMPLE_AGENT_MODE_VERSION', '1.0.0'),
    configurationVersion: readEnv('EXAMPLE_AGENT_CONFIGURATION_VERSION', 'config.default'),
    policyVersion: process.env.EXAMPLE_AGENT_POLICY_VERSION,
    policyHints: parseJsonRecord(process.env.EXAMPLE_AGENT_POLICY_HINTS_JSON) as AgentRuntimeContext['policyHints'],
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

/**
 * Read-only observability client. Envelope emission lives in `macp-sdk-typescript`.
 */
export class ControlPlaneAgentClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly authorization: string;

  constructor() {
    this.baseUrl = readEnv('CONTROL_PLANE_BASE_URL').replace(/\/$/, '');
    this.timeoutMs = Number(readEnv('CONTROL_PLANE_TIMEOUT_MS', '10000'));
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- empty string must fall back to the default
    const apiKey = process.env.CONTROL_PLANE_API_KEY?.trim() || 'example-agent';
    this.authorization = apiKey.startsWith('Bearer ') ? apiKey : `Bearer ${apiKey}`;
  }

  async getRun(runId: string): Promise<RunRecord> {
    return this.request<RunRecord>('GET', `/runs/${runId}`);
  }

  async getEvents(runId: string, afterSeq: number, limit = 200): Promise<CanonicalEvent[]> {
    return this.request<CanonicalEvent[]>('GET', `/runs/${runId}/events?afterSeq=${afterSeq}&limit=${limit}`);
  }

  private async request<T>(method: 'GET', path: string): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          authorization: this.authorization
        },
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

export function extractProposalId(event: CanonicalEvent): string | undefined {
  const payload = extractDecodedPayload(event);
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
  let payload = (data.decodedPayload as JsonRecord | undefined) ?? (data.payload as JsonRecord | undefined);
  if (!payload) {
    const descriptor = data.payloadDescriptor as JsonRecord | undefined;
    const proto = descriptor?.proto as JsonRecord | undefined;
    payload = (proto?.value as JsonRecord | undefined) ?? {};
  }
  return payload;
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

export { logAgent } from './log-agent';
