import { Injectable } from '@nestjs/common';
import { RunExampleRequest, RunExampleResult } from '../contracts/launch';
import { AppConfigService } from '../config/app-config.service';
import { ControlPlaneClient } from '../control-plane/control-plane.client';
import { CompilerService } from '../compiler/compiler.service';
import { HostingService } from '../hosting/hosting.service';

@Injectable()
export class ExampleRunService {
  constructor(
    private readonly compiler: CompilerService,
    private readonly hosting: HostingService,
    private readonly controlPlaneClient: ControlPlaneClient,
    private readonly config: AppConfigService
  ) {}

  async run(request: RunExampleRequest): Promise<RunExampleResult> {
    const compiled = await this.compiler.compile(request);
    const shouldBootstrap = request.bootstrapAgents ?? this.config.autoBootstrapExampleAgents;
    const hostedAgents = shouldBootstrap ? await this.hosting.bootstrap(compiled) : [];

    if (request.submitToControlPlane === false) {
      return {
        compiled,
        hostedAgents,
        controlPlane: {
          baseUrl: this.controlPlaneClient.baseUrl,
          validated: false,
          submitted: false
        }
      };
    }

    await this.controlPlaneClient.validate(compiled.executionRequest);
    const launched = await this.controlPlaneClient.createRun(compiled.executionRequest);

    return {
      compiled,
      hostedAgents,
      controlPlane: {
        baseUrl: this.controlPlaneClient.baseUrl,
        validated: true,
        submitted: true,
        runId: launched.runId,
        status: launched.status,
        traceId: launched.traceId
      }
    };
  }
}
