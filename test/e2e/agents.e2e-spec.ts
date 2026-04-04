import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as path from 'path';
import { AppModule } from '../../src/app.module';
import { AppConfigService } from '../../src/config/app-config.service';
import { GlobalExceptionFilter } from '../../src/errors/exception.filter';

describe('Agents (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const fixturesPacksDir = path.resolve(__dirname, '../fixtures/packs');

    const moduleFixture: TestingModule = await Test.createTestingModule({
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
        logLevel: 'error',
        controlPlaneBaseUrl: 'http://localhost:3001',
        controlPlaneTimeoutMs: 1000,
        autoBootstrapExampleAgents: true,
        exampleAgentPythonPath: 'python3',
        exampleAgentNodePath: process.execPath
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalFilters(new GlobalExceptionFilter());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /agents', () => {
    it('should return all agent profiles', () => {
      return request(app.getHttpServer())
        .get('/agents')
        .expect(200)
        .expect((res: any) => {
          expect(res.body).toHaveLength(4);
          const refs = res.body.map((a: any) => a.agentRef).sort();
          expect(refs).toEqual(['compliance-agent', 'fraud-agent', 'growth-agent', 'risk-agent']);
        });
    });

    it('each agent has scenario coverage across all packs', () => {
      return request(app.getHttpServer())
        .get('/agents')
        .expect(200)
        .expect((res: any) => {
          for (const agent of res.body) {
            expect(agent.scenarios.length).toBeGreaterThanOrEqual(1);
            expect(agent.metrics).toBeDefined();
            expect(agent.metrics.runs).toBe(0);
          }
        });
    });

    it('fraud-agent participates in all 3 scenario packs', () => {
      return request(app.getHttpServer())
        .get('/agents')
        .expect(200)
        .expect((res: any) => {
          const fraudAgent = res.body.find((a: any) => a.agentRef === 'fraud-agent');
          expect(fraudAgent.scenarios).toContain('fraud/high-value-new-device@1.0.0');
          expect(fraudAgent.scenarios).toContain('lending/loan-underwriting@1.0.0');
          expect(fraudAgent.scenarios).toContain('claims/auto-claim-review@1.0.0');
        });
    });

    it('each agent has framework and description', () => {
      return request(app.getHttpServer())
        .get('/agents')
        .expect(200)
        .expect((res: any) => {
          const frameworks = res.body.map((a: any) => a.framework).sort();
          expect(frameworks).toEqual(['crewai', 'custom', 'langchain', 'langgraph']);

          for (const agent of res.body) {
            expect(agent.description).toBeDefined();
            expect(agent.transportIdentity).toContain('agent://');
          }
        });
    });
  });

  describe('GET /agents/:agentRef', () => {
    it('should return a single agent profile', () => {
      return request(app.getHttpServer())
        .get('/agents/fraud-agent')
        .expect(200)
        .expect((res: any) => {
          expect(res.body.agentRef).toBe('fraud-agent');
          expect(res.body.name).toBe('Fraud Agent');
          expect(res.body.framework).toBe('langgraph');
          expect(res.body.description).toBeDefined();
          expect(res.body.scenarios.length).toBeGreaterThanOrEqual(3);
        });
    });

    it('should return 404 for nonexistent agent', () => {
      return request(app.getHttpServer())
        .get('/agents/nonexistent')
        .expect(404)
        .expect((res: any) => {
          expect(res.body.errorCode).toBe('AGENT_NOT_FOUND');
        });
    });
  });

  describe('GET /scenarios (cross-pack)', () => {
    it('should return all scenarios across packs with packSlug', () => {
      return request(app.getHttpServer())
        .get('/scenarios')
        .expect(200)
        .expect((res: any) => {
          expect(res.body.length).toBeGreaterThanOrEqual(3);
          const packSlugs = res.body.map((s: any) => s.packSlug);
          expect(packSlugs).toContain('fraud');
          expect(packSlugs).toContain('lending');
          expect(packSlugs).toContain('claims');

          for (const scenario of res.body) {
            expect(scenario.packSlug).toBeDefined();
            expect(scenario.scenario).toBeDefined();
            expect(scenario.versions).toBeDefined();
          }
        });
    });
  });
});
