import { AppConfigService } from '../config/app-config.service';
import { CompileLaunchResult } from '../contracts/launch';
import { ControlPlaneClient } from '../control-plane/control-plane.client';
import { CompilerService } from '../compiler/compiler.service';
import { HostedExampleAgent } from '../contracts/example-agents';
import { HostingService } from '../hosting/hosting.service';
import { ExampleRunService } from './example-run.service';

describe('ExampleRunService', () => {
  let service: ExampleRunService;
  let compiler: jest.Mocked<CompilerService>;
  let hosting: jest.Mocked<HostingService>;
  let controlPlane: jest.Mocked<ControlPlaneClient>;
  let config: AppConfigService;

  const compiled: CompileLaunchResult = {
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
      participantMetadata: { attachedRunId: 'run-1' }
    }
  ];

  beforeEach(() => {
    compiler = { compile: jest.fn().mockResolvedValue(compiled) } as unknown as jest.Mocked<CompilerService>;
    hosting = {
      resolve: jest.fn().mockResolvedValue(resolvedAgents),
      attach: jest.fn().mockResolvedValue(attachedAgents)
    } as unknown as jest.Mocked<HostingService>;
    controlPlane = {
      validate: jest.fn().mockResolvedValue(undefined),
      createRun: jest.fn().mockResolvedValue({ runId: 'run-1', status: 'queued', traceId: 'trace-1' }),
      baseUrl: 'http://localhost:3001'
    } as unknown as jest.Mocked<ControlPlaneClient>;
    config = {
      autoBootstrapExampleAgents: true
    } as AppConfigService;

    service = new ExampleRunService(compiler, hosting, controlPlane, config);
  });

  it('supports dry-run example launches', async () => {
    const result = await service.run({
      scenarioRef: 'fraud/high-value-new-device@1.0.0',
      submitToControlPlane: false,
      inputs: {}
    });

    expect(hosting.resolve).toHaveBeenCalledWith(compiled);
    expect(hosting.attach).not.toHaveBeenCalled();
    expect(controlPlane.validate).not.toHaveBeenCalled();
    expect(result.hostedAgents).toEqual(resolvedAgents);
    expect(result.controlPlane?.submitted).toBe(false);
  });

  it('validates, submits, and attaches workers to the launched run by default', async () => {
    const result = await service.run({
      scenarioRef: 'fraud/high-value-new-device@1.0.0',
      inputs: {}
    });

    expect(hosting.resolve).toHaveBeenCalledWith(compiled);
    expect(controlPlane.validate).toHaveBeenCalledWith(compiled.executionRequest);
    expect(controlPlane.createRun).toHaveBeenCalledWith(compiled.executionRequest);
    expect(hosting.attach).toHaveBeenCalledWith(compiled, {
      runId: 'run-1',
      traceId: 'trace-1',
      scenarioRef: 'fraud/high-value-new-device@1.0.0',
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
      sessionContext: undefined,
      participants: ['risk-agent'],
      initiatorParticipantId: 'risk-agent'
    });
    expect(result.hostedAgents).toEqual(attachedAgents);
    expect(result.controlPlane?.runId).toBe('run-1');
  });
});
