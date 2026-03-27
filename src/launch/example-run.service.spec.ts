import { AppConfigService } from '../config/app-config.service';
import { CompileLaunchResult } from '../contracts/launch';
import { ControlPlaneClient } from '../control-plane/control-plane.client';
import { CompilerService } from '../compiler/compiler.service';
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
        ttlMs: 300000,
        participants: []
      }
    },
    display: {
      title: 'Fraud',
      scenarioRef: 'fraud/high-value-new-device@1.0.0'
    },
    participantBindings: []
  };

  beforeEach(() => {
    compiler = { compile: jest.fn().mockResolvedValue(compiled) } as unknown as jest.Mocked<CompilerService>;
    hosting = { bootstrap: jest.fn().mockResolvedValue([]) } as unknown as jest.Mocked<HostingService>;
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

    expect(controlPlane.validate).not.toHaveBeenCalled();
    expect(result.controlPlane?.submitted).toBe(false);
  });

  it('validates and submits to the control plane by default', async () => {
    const result = await service.run({
      scenarioRef: 'fraud/high-value-new-device@1.0.0',
      inputs: {}
    });

    expect(hosting.bootstrap).toHaveBeenCalled();
    expect(controlPlane.validate).toHaveBeenCalledWith(compiled.executionRequest);
    expect(controlPlane.createRun).toHaveBeenCalledWith(compiled.executionRequest);
    expect(result.controlPlane?.runId).toBe('run-1');
  });
});
