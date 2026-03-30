export type AgentFramework = 'langgraph' | 'langchain' | 'crewai' | 'custom';

export type EntrypointType = 'python_module' | 'python_file' | 'node_file' | 'container';

export interface AgentManifest {
  id: string;
  name: string;
  framework: AgentFramework;
  version?: string;
  entrypoint: {
    type: EntrypointType;
    value: string;
  };
  host?: {
    python?: string;
    node?: string;
    env?: Record<string, string>;
    args?: string[];
    cwd?: string;
    requirementsFile?: string;
    install?: boolean;
    startupTimeoutMs?: number;
    healthTimeoutMs?: number;
  };
  macp?: {
    role?: string;
    supportedMessageTypes?: string[];
    capabilities?: string[];
  };
  frameworkConfig?: Record<string, unknown>;
}

export interface LangGraphFrameworkConfig {
  graphFactory: string;
  inputMapper: string;
  outputMapper: string;
  checkpointer?: string;
  configPath?: string;
}

export interface LangChainFrameworkConfig {
  factory: string;
  invokeMode?: 'invoke' | 'stream' | 'batch';
  inputMapper: string;
  outputMapper: string;
  toolsModule?: string;
}

export interface CrewAIFrameworkConfig {
  crewFactory: string;
  inputMapper: string;
  outputMapper: string;
  agentsModule?: string;
  tasksModule?: string;
}

export interface CustomFrameworkConfig {
  entryFunction?: string;
  inputMapper?: string;
  outputMapper?: string;
}

export interface ManifestValidationResult {
  valid: boolean;
  errors: string[];
}
