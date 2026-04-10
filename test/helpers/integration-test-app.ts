import 'reflect-metadata';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as path from 'node:path';
import { AppModule } from '../../src/app.module';
import { AppConfigService } from '../../src/config/app-config.service';
import { GlobalExceptionFilter } from '../../src/errors/exception.filter';
import { MockControlPlane } from './mock-control-plane';
import { IntegrationTestClient } from './integration-test-client';

export type ControlPlaneMode = 'mock' | 'docker' | 'remote';

export interface IntegrationTestContext {
  app: INestApplication;
  url: string;
  client: IntegrationTestClient;
  mockControlPlane: MockControlPlane | null;
  module: TestingModule;
  controlPlaneMode: ControlPlaneMode;
  cleanup: () => Promise<void>;
}

export async function createIntegrationTestApp(
  overrides?: Partial<{
    controlPlaneBaseUrl: string;
    controlPlaneApiKey: string;
    controlPlaneTimeoutMs: number;
    autoBootstrapExampleAgents: boolean;
    authApiKeys: string[];
    mockControlPlaneOptions: { requiredBearerToken?: string };
  }>
): Promise<IntegrationTestContext> {
  const controlPlaneMode = (process.env.INTEGRATION_CONTROL_PLANE ?? 'mock') as ControlPlaneMode;
  const fixturesPacksDir = path.resolve(__dirname, '../fixtures/packs');

  let mockControlPlane: MockControlPlane | null = null;
  let controlPlaneBaseUrl: string;
  let controlPlaneApiKey: string | undefined;

  if (controlPlaneMode === 'mock') {
    mockControlPlane = new MockControlPlane(overrides?.mockControlPlaneOptions);
    await mockControlPlane.start();
    controlPlaneBaseUrl = overrides?.controlPlaneBaseUrl ?? mockControlPlane.baseUrl;
    controlPlaneApiKey = overrides?.controlPlaneApiKey;
  } else {
    controlPlaneBaseUrl =
      overrides?.controlPlaneBaseUrl ?? process.env.CONTROL_PLANE_BASE_URL ?? 'http://localhost:3001';
    controlPlaneApiKey = overrides?.controlPlaneApiKey ?? process.env.CONTROL_PLANE_API_KEY;
    mockControlPlane = null;
  }

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule]
  })
    .overrideProvider(AppConfigService)
    .useValue({
      packsDir: fixturesPacksDir,
      registryCacheTtlMs: 0,
      corsOrigin: '*',
      isDevelopment: true,
      port: 0,
      host: '0.0.0.0',
      logLevel: 'warn',
      controlPlaneBaseUrl,
      controlPlaneApiKey,
      controlPlaneTimeoutMs: overrides?.controlPlaneTimeoutMs ?? 5000,
      autoBootstrapExampleAgents: overrides?.autoBootstrapExampleAgents ?? true,
      registerPoliciesOnLaunch: true,
      exampleAgentPythonPath: 'python3',
      exampleAgentNodePath: process.execPath,
      authApiKeys: overrides?.authApiKeys ?? []
    })
    .compile();

  const app = moduleRef.createNestApplication();
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false
    })
  );

  await app.listen(0);
  const url = await app.getUrl();
  const client = new IntegrationTestClient(url);

  const cleanup = async () => {
    await app.close();
    if (mockControlPlane) {
      await mockControlPlane.stop();
    }
  };

  return {
    app,
    url,
    client,
    mockControlPlane,
    module: moduleRef,
    controlPlaneMode,
    cleanup
  };
}
