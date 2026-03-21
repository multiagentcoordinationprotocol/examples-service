export interface PackFile {
  apiVersion: 'scenarios.macp.dev/v1';
  kind: 'ScenarioPack';
  metadata: {
    slug: string;
    name: string;
    description?: string;
    tags?: string[];
  };
}

export interface PackSummary {
  slug: string;
  name: string;
  description?: string;
  tags?: string[];
}

export interface ParticipantTemplate {
  id: string;
  role: string;
  agentRef: string;
}

export interface KickoffTemplate {
  from: string;
  to: string[];
  kind: string;
  payload: Record<string, unknown>;
}

export interface ScenarioVersionFile {
  apiVersion: 'scenarios.macp.dev/v1';
  kind: 'ScenarioVersion';
  metadata: {
    pack: string;
    scenario: string;
    version: string;
    name: string;
    summary?: string;
    tags?: string[];
    deprecated?: boolean;
  };
  spec: {
    inputs: {
      schema: Record<string, unknown>;
    };
    launch: {
      modeName: string;
      modeVersion: string;
      configurationVersion: string;
      ttlMs: number;
      participants: ParticipantTemplate[];
      contextTemplate?: Record<string, unknown>;
      kickoffTemplate?: KickoffTemplate[];
      metadataTemplate?: Record<string, unknown>;
    };
    outputs?: {
      expectedDecisionKinds?: string[];
      expectedSignals?: string[];
    };
  };
}

export interface ScenarioTemplateFile {
  apiVersion: 'scenarios.macp.dev/v1';
  kind: 'ScenarioTemplate';
  metadata: {
    scenarioVersion: string;
    slug: string;
    name: string;
  };
  spec: {
    defaults?: Record<string, unknown>;
    overrides?: {
      launch?: Partial<ScenarioVersionFile['spec']['launch']>;
    };
  };
}

export interface ScenarioSummary {
  scenario: string;
  name: string;
  summary?: string;
  versions: string[];
  templates: string[];
  tags?: string[];
}

export interface PackEntry {
  pack: PackFile;
  scenarios: Map<string, ScenarioEntry>;
}

export interface ScenarioEntry {
  versions: Map<string, ScenarioVersionEntry>;
}

export interface ScenarioVersionEntry {
  scenario: ScenarioVersionFile;
  templates: Map<string, ScenarioTemplateFile>;
}

export interface RegistrySnapshot {
  packs: Map<string, PackEntry>;
  loadedAt: number;
}
