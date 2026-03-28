import * as childProcess from 'node:child_process';
import * as fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { AppConfigService } from '../config/app-config.service';
import { ExampleAgentDefinition, ExampleAgentRunContext, ParticipantAgentBinding } from '../contracts/example-agents';
import { ProcessExampleAgentHostProvider } from './process-example-agent-host.provider';

jest.mock('node:child_process');
jest.mock('node:fs');

function buildDefinition(overrides?: Partial<ExampleAgentDefinition>): ExampleAgentDefinition {
  return {
    agentRef: 'fraud-agent',
    name: 'Fraud Agent',
    role: 'fraud',
    framework: 'langgraph',
    bootstrap: {
      strategy: 'external',
      entrypoint: 'agents/python/langgraph_fraud_agent.py',
      transportIdentity: 'agent://fraud-agent',
      mode: 'attached',
      launcher: 'python'
    },
    tags: ['fraud'],
    ...overrides
  };
}

function buildBinding(overrides?: Partial<ParticipantAgentBinding>): ParticipantAgentBinding {
  return {
    participantId: 'fraud-agent',
    role: 'fraud',
    agentRef: 'fraud-agent',
    ...overrides
  };
}

function buildContext(overrides?: Partial<ExampleAgentRunContext>): ExampleAgentRunContext {
  return {
    runId: 'run-1',
    scenarioRef: 'fraud/high-value-new-device@1.0.0',
    modeName: 'macp.mode.decision.v1',
    modeVersion: '1.0.0',
    configurationVersion: 'config.default',
    ttlMs: 300000,
    participants: ['fraud-agent', 'risk-agent'],
    ...overrides
  };
}

function createMockChild(): childProcess.ChildProcess {
  const child = new EventEmitter() as unknown as childProcess.ChildProcess;
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  Object.defineProperty(child, 'stdout', { value: stdout });
  Object.defineProperty(child, 'stderr', { value: stderr });
  Object.defineProperty(child, 'pid', { value: 12345 });
  (child as unknown as { kill: jest.Mock }).kill = jest.fn();
  return child;
}

describe('ProcessExampleAgentHostProvider', () => {
  let provider: ProcessExampleAgentHostProvider;
  let config: AppConfigService;

  beforeEach(() => {
    config = {
      exampleAgentPythonPath: 'python3',
      exampleAgentNodePath: '/usr/local/bin/node',
      controlPlaneBaseUrl: 'http://localhost:3001',
      controlPlaneApiKey: 'test-key',
      controlPlaneTimeoutMs: 10000
    } as AppConfigService;

    provider = new ProcessExampleAgentHostProvider(config);

    jest.clearAllMocks();
  });

  describe('resolve', () => {
    it('returns metadata with status resolved and processAttached false', async () => {
      const result = await provider.resolve(buildDefinition(), buildBinding());

      expect(result.status).toBe('resolved');
      expect(result.participantMetadata?.processAttached).toBe(false);
      expect(result.participantMetadata?.hostMode).toBe('external-process');
      expect(result.transportIdentity).toBe('agent://fraud-agent');
      expect(result.framework).toBe('langgraph');
    });

    it('infers python launcher from .py extension when launcher is not set', async () => {
      const definition = buildDefinition({
        bootstrap: {
          ...buildDefinition().bootstrap,
          launcher: undefined
        }
      });

      const result = await provider.resolve(definition, buildBinding());

      expect(result.participantMetadata?.launcher).toBe('python');
    });

    it('infers node launcher for non-.py entrypoints', async () => {
      const definition = buildDefinition({
        bootstrap: {
          ...buildDefinition().bootstrap,
          launcher: undefined,
          entrypoint: 'src/example-agents/runtime/risk-decider.worker.ts'
        }
      });

      const result = await provider.resolve(definition, buildBinding());

      expect(result.participantMetadata?.launcher).toBe('node');
    });
  });

  describe('attach', () => {
    it('returns bootstrapped without spawning when mode is not attached', async () => {
      const definition = buildDefinition({
        bootstrap: {
          ...buildDefinition().bootstrap,
          mode: 'deferred'
        }
      });

      const result = await provider.attach(definition, buildBinding(), buildContext());

      expect(result.status).toBe('bootstrapped');
      expect(result.participantMetadata?.processAttached).toBe(false);
      expect(result.participantMetadata?.attachmentMode).toBe('deferred');
      expect(childProcess.spawn).not.toHaveBeenCalled();
    });

    it('spawns a python process for attached mode', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (childProcess.spawn as jest.Mock).mockReturnValue(createMockChild());

      const result = await provider.attach(buildDefinition(), buildBinding(), buildContext());

      expect(childProcess.spawn).toHaveBeenCalledWith(
        'python3',
        expect.arrayContaining([expect.stringContaining('langgraph_fraud_agent.py')]),
        expect.objectContaining({
          env: expect.objectContaining({
            EXAMPLE_AGENT_RUN_ID: 'run-1',
            EXAMPLE_AGENT_PARTICIPANT_ID: 'fraud-agent',
            EXAMPLE_AGENT_FRAMEWORK: 'langgraph',
            CONTROL_PLANE_BASE_URL: 'http://localhost:3001'
          })
        })
      );
      expect(result.status).toBe('bootstrapped');
      expect(result.participantMetadata?.processAttached).toBe(true);
      expect(result.participantMetadata?.pid).toBe(12345);
    });

    it('resolves node entrypoints from src/ to dist/', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (childProcess.spawn as jest.Mock).mockReturnValue(createMockChild());

      const definition = buildDefinition({
        agentRef: 'risk-agent',
        framework: 'custom',
        bootstrap: {
          ...buildDefinition().bootstrap,
          entrypoint: 'src/example-agents/runtime/risk-decider.worker.ts',
          launcher: 'node'
        }
      });

      await provider.attach(definition, buildBinding({ participantId: 'risk-agent', agentRef: 'risk-agent' }), buildContext());

      expect(childProcess.spawn).toHaveBeenCalledWith(
        '/usr/local/bin/node',
        expect.arrayContaining([expect.stringContaining('dist/example-agents/runtime/risk-decider.worker.js')]),
        expect.any(Object)
      );
    });

    it('throws when entrypoint file does not exist', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);

      await expect(provider.attach(buildDefinition(), buildBinding(), buildContext())).rejects.toThrow(
        /entrypoint not found/
      );
    });

    it('deduplicates by runId:participantId', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (childProcess.spawn as jest.Mock).mockReturnValue(createMockChild());

      await provider.attach(buildDefinition(), buildBinding(), buildContext());
      const second = await provider.attach(buildDefinition(), buildBinding(), buildContext());

      expect(childProcess.spawn).toHaveBeenCalledTimes(1);
      expect(second.status).toBe('bootstrapped');
      expect(second.participantMetadata?.processAttached).toBe(true);
    });
  });

  describe('onModuleDestroy', () => {
    it('sends SIGTERM to all tracked processes', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      const mockChild = createMockChild();
      (childProcess.spawn as jest.Mock).mockReturnValue(mockChild);

      await provider.attach(buildDefinition(), buildBinding(), buildContext());
      provider.onModuleDestroy();

      expect((mockChild as unknown as { kill: jest.Mock }).kill).toHaveBeenCalledWith('SIGTERM');
    });
  });
});
