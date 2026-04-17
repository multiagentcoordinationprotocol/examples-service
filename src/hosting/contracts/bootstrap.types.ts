/**
 * Bootstrap payload written by the examples-service for each spawned agent.
 *
 * Carries everything the agent needs to authenticate to the runtime directly,
 * participate in the session, and (if the initiator) emit SessionStart + the
 * first mode-specific envelope.
 *
 * See `ui-console/plans/direct-agent-auth.md` § "Agent bootstrap" for the
 * narrative schema, and the canonical JSON Schema at:
 *   multiagentcoordinationprotocol/schemas/json/macp-agent-bootstrap.schema.json
 */
export interface BootstrapPayload {
  run: {
    runId: string;
    /**
     * Pre-allocated by the examples-service (UUID v4). Every agent in a run
     * receives the same sessionId; the initiator uses it when emitting
     * SessionStart. Guaranteed to be present for any launch that goes through
     * `ExampleRunService.run()`.
     */
    sessionId: string;
    traceId?: string;
  };
  participant: {
    participantId: string;
    agentId: string;
    displayName: string;
    role: string;
  };
  runtime: {
    /**
     * gRPC address of the MACP runtime (e.g. `runtime.local:50051`). Populated
     * when direct-agent-auth is enabled; when empty the agent falls back to
     * the legacy HTTP bridge via `baseUrl`.
     */
    address?: string;
    /**
     * Bearer token issued to THIS agent. Used with the runtime's
     * `MACP_AUTH_TOKENS_JSON` identity entry; see RFC-MACP-0004 §4. Omitted
     * when the agent is expected to fall back to the legacy HTTP path.
     */
    bearerToken?: string;
    /**
     * TLS flag for the direct-to-runtime gRPC channel. Defaults to true per
     * RFC-MACP-0006 §3; combine with `allowInsecure` only in local dev.
     */
    tls?: boolean;
    allowInsecure?: boolean;

    // Legacy HTTP bridge (narrowed to read-only observability after ES-8).
    baseUrl: string;
    /** @deprecated legacy HTTP write path; kept for backward compatibility with pre-0.2 agents. */
    messageEndpoint: string;
    eventsEndpoint: string;
    apiKey?: string;
    timeoutMs: number;
    /** @deprecated alias retained for older workers. */
    runtimeUrl?: string;
    /** @deprecated alias retained for older workers. */
    secure?: boolean;
    joinMetadata: {
      transport: 'http' | 'grpc';
      messageFormat: 'macp';
    };
  };
  execution: {
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
    tags?: string[];
    requester?: string;
  };
  session: {
    context: Record<string, unknown>;
    participants: string[];
    metadata?: Record<string, unknown>;
  };
  /**
   * @deprecated Initiator kickoff lives on `initiator.kickoff` starting with
   * direct-agent-auth. Retained at the top level for backward compatibility
   * with legacy workers that read it directly.
   */
  kickoff?: {
    messageType: string;
    payload: Record<string, unknown>;
  };
  agent: {
    manifest: Record<string, unknown>;
    framework: string;
    frameworkConfig?: Record<string, unknown>;
  };
  /**
   * Present ONLY on the bootstrap file for the initiator agent. Contains the
   * payload the initiator uses when emitting the first SessionStart envelope
   * and the first mode-specific envelope (e.g. Proposal). Non-initiators have
   * `initiator` absent and just attach to the session's read stream.
   */
  initiator?: {
    sessionStart: {
      intent: string;
      participants: string[];
      ttlMs: number;
      modeVersion: string;
      configurationVersion: string;
      policyVersion?: string;
      context?: Record<string, unknown>;
      roots?: Array<{ uri: string; name?: string }>;
    };
    kickoff?: {
      messageType: string;
      /** Proto typeName that the agent should encode payload with. */
      payloadType?: string;
      payload: Record<string, unknown>;
    };
  };
  /**
   * Local HTTP callback the control-plane (or any operator) can POST to when
   * a cancel is requested for this run. The agent listens on
   * `http://host:port{path}` with `{ runId, reason }` body. RFC-0001 §7.2
   * Option A. Empty/absent when the deployment opts into policy-delegated
   * cancellation (Option B).
   */
  cancelCallback?: {
    host: string;
    port: number;
    path: string;
  };
}

export interface BootstrapDelivery {
  filePath: string;
  env: Record<string, string>;
}
