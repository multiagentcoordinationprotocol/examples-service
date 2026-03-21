import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { CatalogService } from './catalog/catalog.service';
import { ConfigModule } from './config/config.module';
import { CatalogController } from './controllers/catalog.controller';
import { HealthController } from './controllers/health.controller';
import { LaunchController } from './controllers/launch.controller';
import { CompilerService } from './launch/compiler.service';
import { LaunchService } from './launch/launch.service';
import { CorrelationIdMiddleware } from './middleware/correlation-id.middleware';
import { RequestLoggerMiddleware } from './middleware/request-logger.middleware';
import { FileRegistryLoader } from './registry/file-registry.loader';
import { RegistryIndexService } from './registry/registry-index.service';

@Module({
  imports: [ConfigModule],
  controllers: [HealthController, CatalogController, LaunchController],
  providers: [FileRegistryLoader, RegistryIndexService, CatalogService, LaunchService, CompilerService]
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware, RequestLoggerMiddleware).forRoutes('*');
  }
}
