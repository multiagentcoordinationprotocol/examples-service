export interface BootstrapPayload {
  run: {
    runId: string;
    sessionId?: string;
    traceId?: string;
  };
  participant: {
    participantId: string;
    agentId: string;
    displayName: string;
    role: string;
  };
  runtime: {
    baseUrl: string;
    messageEndpoint: string;
    eventsEndpoint: string;
    apiKey?: string;
    timeoutMs: number;
    joinMetadata: {
      transport: 'http';
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
  kickoff?: {
    messageType: string;
    payload: Record<string, unknown>;
  };
  agent: {
    manifest: Record<string, unknown>;
    framework: string;
    frameworkConfig?: Record<string, unknown>;
  };
}

export interface BootstrapDelivery {
  filePath: string;
  env: Record<string, string>;
}
