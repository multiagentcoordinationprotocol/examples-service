import { AppConfigService } from '../config/app-config.service';
import { CompileLaunchResult } from '../contracts/launch';
import { CompilerService } from '../compiler/compiler.service';
import { HostedExampleAgent } from '../contracts/example-agents';
import { HostingService } from '../hosting/hosting.service';
import { ExampleRunService } from './example-run.service';

describe('ExampleRunService', () => {
  let service: ExampleRunService;
  let compiler: jest.Mocked<CompilerService>;
  let hosting: jest.Mocked<HostingService>;
  let config: AppConfigService;

  const sessionId = '00000000-0000-4000-8000-000000000001';
  const compiled: CompileLaunchResult = {
    sessionId,
    runDescriptor: {
      mode: 'sandbox',
      runtime: { kind: 'rust' },
      session: {
        sessionId,
        modeName: 'macp.mode.decision.v1',
        modeVersion: '1.0.0',
        configurationVersion: 'config.default',
        policyVersion: 'policy.default',
        ttlMs: 300000,
        participants: [{ id: 'risk-agent' }]
      }
    },
    initiator: {
      participantId: 'risk-agent',
      sessionStart: {
        intent: 'fraud/high-value-new-device',
        participants: ['risk-agent'],
        ttlMs: 300000,
        modeVersion: '1.0.0',
        configurationVersion: 'config.default',
        policyVersion: 'policy.default'
      }
    },
    executionRequest: {
      mode: 'sandbox',
      runtime: { kind: 'rust', version: 'v1' },
      session: {
        modeName: 'macp.mode.decision.v1',
        modeVersion: '1.0.0',
        configurationVersion: 'config.default',
        policyVersion: 'policy.default',
        policyHints: {
          type: 'none',
          description: 'No governance constraints',
          vetoThreshold: 1,
          minimumConfidence: 0.0,
          designatedRoles: []
        },
        ttlMs: 300000,
        initiatorParticipantId: 'risk-agent',
        participants: [{ id: 'risk-agent', role: 'risk' }]
      }
    },
    display: {
      title: 'Fraud',
      scenarioRef: 'fraud/high-value-new-device@1.0.0'
    },
    participantBindings: [{ participantId: 'risk-agent', role: 'risk', agentRef: 'risk-agent' }]
  };

  const resolvedAgents: HostedExampleAgent[] = [
    {
      participantId: 'risk-agent',
      agentRef: 'risk-agent',
      name: 'Risk Agent',
      role: 'risk',
      framework: 'custom',
      transportIdentity: 'agent://risk-agent',
      entrypoint: 'src/example-agents/runtime/risk-decider.worker.ts',
      bootstrapStrategy: 'external',
      bootstrapMode: 'attached',
      status: 'resolved'
    }
  ];

  const attachedAgents: HostedExampleAgent[] = [
    {
      ...resolvedAgents[0],
      status: 'bootstrapped',
      participantMetadata: { attachedRunId: sessionId }
    }
  ];

  beforeEach(() => {
    compiler = { compile: jest.fn().mockResolvedValue(compiled) } as unknown as jest.Mocked<CompilerService>;
    hosting = {
      resolve: jest.fn().mockResolvedValue(resolvedAgents),
      attach: jest.fn().mockResolvedValue(attachedAgents)
    } as unknown as jest.Mocked<HostingService>;
    config = {
      autoBootstrapExampleAgents: true
    } as AppConfigService;

    service = new ExampleRunService(compiler, hosting, config);
  });

  it('compiles and attaches agents with sessionId', async () => {
    const result = await service.run({
      scenarioRef: 'fraud/high-value-new-device@1.0.0',
      inputs: {}
    });

    expect(hosting.resolve).toHaveBeenCalledWith(compiled);
    expect(hosting.attach).toHaveBeenCalledWith(
      compiled,
      expect.objectContaining({
        runId: sessionId,
        sessionId,
        scenarioRef: 'fraud/high-value-new-device@1.0.0',
        modeName: 'macp.mode.decision.v1',
        modeVersion: '1.0.0',
        participants: ['risk-agent'],
        initiator: compiled.initiator
      })
    );
    expect(result.hostedAgents).toEqual(attachedAgents);
    expect(result.sessionId).toBe(sessionId);
  });

  it('does not call any control-plane endpoints', async () => {
    await service.run({
      scenarioRef: 'fraud/high-value-new-device@1.0.0',
      inputs: {}
    });

    // No CP dependency at all — just compile + attach
    expect(compiler.compile).toHaveBeenCalled();
    expect(hosting.attach).toHaveBeenCalled();
  });

  it('skips attach when bootstrapAgents is false', async () => {
    config = { autoBootstrapExampleAgents: false } as AppConfigService;
    service = new ExampleRunService(compiler, hosting, config);

    const result = await service.run({
      scenarioRef: 'fraud/high-value-new-device@1.0.0',
      bootstrapAgents: false,
      inputs: {}
    });

    expect(hosting.resolve).not.toHaveBeenCalled();
    expect(hosting.attach).not.toHaveBeenCalled();
    expect(result.hostedAgents).toEqual([]);
    expect(result.sessionId).toBeUndefined();
  });

  describe('applyRequestOverrides', () => {
    it('merges tags', async () => {
      const result = await service.run({
        scenarioRef: 'fraud/high-value-new-device@1.0.0',
        inputs: {},
        tags: ['extra-tag', 'owner:qa']
      });

      const executionTags = result.compiled.executionRequest.execution?.tags ?? [];
      expect(executionTags).toEqual(expect.arrayContaining(['extra-tag', 'owner:qa']));
    });

    it('overrides requester', async () => {
      const result = await service.run({
        scenarioRef: 'fraud/high-value-new-device@1.0.0',
        inputs: {},
        requester: { actorId: 'qa-bot', actorType: 'service' }
      });

      expect(result.compiled.executionRequest.execution?.requester).toEqual({
        actorId: 'qa-bot',
        actorType: 'service'
      });
    });

    it('stamps runLabel', async () => {
      const result = await service.run({
        scenarioRef: 'fraud/high-value-new-device@1.0.0',
        inputs: {},
        runLabel: 'nightly-2026-04-15'
      });

      expect(result.compiled.executionRequest.session.metadata?.runLabel).toBe('nightly-2026-04-15');
    });
  });
});
