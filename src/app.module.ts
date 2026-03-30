import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { CatalogService } from './catalog/catalog.service';
import { CompilerService } from './compiler/compiler.service';
import { ConfigModule } from './config/config.module';
import { ControlPlaneClient } from './control-plane/control-plane.client';
import { CatalogController } from './controllers/catalog.controller';
import { ExamplesController } from './controllers/examples.controller';
import { HealthController } from './controllers/health.controller';
import { LaunchController } from './controllers/launch.controller';
import { ExampleAgentCatalogService } from './example-agents/example-agent-catalog.service';
import { EXAMPLE_AGENT_HOST_PROVIDER } from './hosting/example-agent-host.provider';
import { HostingService } from './hosting/hosting.service';
import { ProcessExampleAgentHostProvider } from './hosting/process-example-agent-host.provider';
import { HostAdapterRegistry } from './hosting/host-adapter-registry';
import { LaunchSupervisor } from './hosting/launch-supervisor';
import { ManifestValidator } from './hosting/manifest-validator';
import { ExampleRunService } from './launch/example-run.service';
import { LaunchService } from './launch/launch.service';
import { ApiKeyGuard } from './middleware/api-key.guard';
import { CorrelationIdMiddleware } from './middleware/correlation-id.middleware';
import { RequestLoggerMiddleware } from './middleware/request-logger.middleware';
import { FileRegistryLoader } from './registry/file-registry.loader';
import { RegistryIndexService } from './registry/registry-index.service';

@Module({
  imports: [
    ConfigModule,
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }])
  ],
  controllers: [HealthController, CatalogController, LaunchController, ExamplesController],
  providers: [
    FileRegistryLoader,
    RegistryIndexService,
    CatalogService,
    LaunchService,
    CompilerService,
    ExampleAgentCatalogService,
    HostAdapterRegistry,
    LaunchSupervisor,
    ManifestValidator,
    ProcessExampleAgentHostProvider,
    {
      provide: EXAMPLE_AGENT_HOST_PROVIDER,
      useExisting: ProcessExampleAgentHostProvider
    },
    HostingService,
    ControlPlaneClient,
    ExampleRunService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: ApiKeyGuard }
  ]
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware, RequestLoggerMiddleware).forRoutes('*');
  }
}
