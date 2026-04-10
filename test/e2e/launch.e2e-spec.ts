import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as path from 'path';
import { AppModule } from '../../src/app.module';
import { AppConfigService } from '../../src/config/app-config.service';
import { GlobalExceptionFilter } from '../../src/errors/exception.filter';

describe('Launch (e2e)', () => {
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

  describe('GET launch-schema', () => {
    const basePath = '/packs/fraud/scenarios/high-value-new-device/versions/1.0.0/launch-schema';

    it('should return launch schema without template', () => {
      return request(app.getHttpServer())
        .get(basePath)
        .expect(200)
        .expect((res: any) => {
          expect(res.body.scenarioRef).toBe('fraud/high-value-new-device@1.0.0');
          expect(res.body.formSchema).toBeDefined();
          expect(res.body.defaults).toBeDefined();
          expect(res.body.participants).toHaveLength(4);
          expect(res.body.agents).toHaveLength(4);
          expect(res.body.runtime).toEqual({ kind: 'rust', version: 'v1' });
          expect(res.body.launchSummary.ttlMs).toBe(300000);
          expect(res.body.launchSummary.policyVersion).toBe('policy.default');
          expect(res.body.launchSummary.policyHints).toEqual({
            type: 'none',
            description: 'Default policy — no additional governance constraints',
            vetoThreshold: 1,
            minimumConfidence: 0,
            designatedRoles: []
          });
          expect(res.body.expectedDecisionKinds).toEqual(['approve', 'step_up', 'decline']);
        });
    });

    it('should return template-specific schema with ?template=strict-risk', () => {
      return request(app.getHttpServer())
        .get(`${basePath}?template=strict-risk`)
        .expect(200)
        .expect((res: any) => {
          expect(res.body.templateId).toBe('strict-risk');
          expect(res.body.defaults.deviceTrustScore).toBe(0.08);
          expect(res.body.launchSummary.ttlMs).toBe(180000);
        });
    });

    it('should return 404 for nonexistent template', () => {
      return request(app.getHttpServer())
        .get(`${basePath}?template=nonexistent`)
        .expect(404)
        .expect((res: any) => {
          expect(res.body.errorCode).toBe('TEMPLATE_NOT_FOUND');
        });
    });

    it('should return 404 for nonexistent version', () => {
      return request(app.getHttpServer())
        .get('/packs/fraud/scenarios/high-value-new-device/versions/9.9.9/launch-schema')
        .expect(404)
        .expect((res: any) => {
          expect(res.body.errorCode).toBe('VERSION_NOT_FOUND');
        });
    });
  });

  describe('POST /launch/compile', () => {
    it('should compile valid inputs into an ExecutionRequest', () => {
      return request(app.getHttpServer())
        .post('/launch/compile')
        .send({
          scenarioRef: 'fraud/high-value-new-device@1.0.0',
          templateId: 'default',
          mode: 'sandbox',
          inputs: {
            transactionAmount: 3200,
            deviceTrustScore: 0.12,
            accountAgeDays: 5,
            isVipCustomer: true,
            priorChargebacks: 1
          }
        })
        .expect(201)
        .expect((res: any) => {
          expect(res.body.executionRequest).toBeDefined();
          expect(res.body.executionRequest.mode).toBe('sandbox');
          expect(res.body.executionRequest.runtime).toEqual({ kind: 'rust', version: 'v1' });
          expect(res.body.executionRequest.session.modeName).toBe('macp.mode.decision.v1');
          expect(res.body.executionRequest.session.policyVersion).toBe('policy.default');
          expect(res.body.executionRequest.session.policyHints).toEqual({
            type: 'none',
            description: 'Default policy — no additional governance constraints',
            vetoThreshold: 1,
            minimumConfidence: 0,
            designatedRoles: []
          });
          expect(res.body.executionRequest.session.participants).toHaveLength(4);
          expect(res.body.executionRequest.session.context.transactionAmount).toBe(3200);
          expect(res.body.executionRequest.session.context.isVipCustomer).toBe(true);
          expect(res.body.executionRequest.session.metadata.source).toBe('example-service');
          expect(res.body.executionRequest.kickoff).toHaveLength(1);
          expect(res.body.executionRequest.kickoff[0].messageType).toBe('Proposal');
          expect(res.body.participantBindings).toHaveLength(4);
          expect(res.body.display.title).toBe('High Value Purchase From New Device');
        });
    });

    it('should return 400 for invalid inputs', () => {
      return request(app.getHttpServer())
        .post('/launch/compile')
        .send({
          scenarioRef: 'fraud/high-value-new-device@1.0.0',
          inputs: {
            transactionAmount: -5,
            deviceTrustScore: 0.5,
            accountAgeDays: 10,
            isVipCustomer: true,
            priorChargebacks: 0
          }
        })
        .expect(400)
        .expect((res: any) => {
          expect(res.body.errorCode).toBe('VALIDATION_ERROR');
        });
    });

    it('should return 400 for invalid scenarioRef', () => {
      return request(app.getHttpServer())
        .post('/launch/compile')
        .send({
          scenarioRef: 'bad-ref',
          inputs: {}
        })
        .expect(400)
        .expect((res: any) => {
          expect(res.body.errorCode).toBe('INVALID_SCENARIO_REF');
        });
    });

    it('should return 404 for unknown scenario', () => {
      return request(app.getHttpServer())
        .post('/launch/compile')
        .send({
          scenarioRef: 'fraud/nonexistent@1.0.0',
          inputs: {}
        })
        .expect(404)
        .expect((res: any) => {
          expect(res.body.errorCode).toBe('SCENARIO_NOT_FOUND');
        });
    });
  });

  describe('POST /examples/run', () => {
    it('should compile, bootstrap example agents, and skip control plane submission when requested', () => {
      return request(app.getHttpServer())
        .post('/examples/run')
        .send({
          scenarioRef: 'fraud/high-value-new-device@1.0.0',
          templateId: 'strict-risk',
          submitToControlPlane: false,
          inputs: {
            transactionAmount: 3200,
            deviceTrustScore: 0.12,
            accountAgeDays: 5,
            isVipCustomer: true,
            priorChargebacks: 1
          }
        })
        .expect(201)
        .expect((res: any) => {
          expect(res.body.compiled.executionRequest).toBeDefined();
          expect(res.body.hostedAgents).toHaveLength(4);
          expect(res.body.hostedAgents[0].transportIdentity).toContain('agent://');
          expect(res.body.hostedAgents[2].framework).toBe('crewai');
          expect(res.body.controlPlane.submitted).toBe(false);
        });
    });

    it('should merge tags, requester, and runLabel into execution request', () => {
      return request(app.getHttpServer())
        .post('/examples/run')
        .send({
          scenarioRef: 'fraud/high-value-new-device@1.0.0',
          submitToControlPlane: false,
          inputs: {
            transactionAmount: 3200,
            deviceTrustScore: 0.12,
            accountAgeDays: 5,
            isVipCustomer: true,
            priorChargebacks: 1
          },
          tags: ['ui-launch', 'experiment-1'],
          requester: { actorId: 'tester@example.com', actorType: 'user' },
          runLabel: 'E2E test run'
        })
        .expect(201)
        .expect((res: any) => {
          const execution = res.body.compiled.executionRequest.execution;
          expect(execution.tags).toContain('ui-launch');
          expect(execution.tags).toContain('experiment-1');
          expect(execution.tags).toContain('example');
          expect(execution.requester.actorId).toBe('tester@example.com');
          expect(execution.requester.actorType).toBe('user');

          const metadata = res.body.compiled.executionRequest.session.metadata;
          expect(metadata.runLabel).toBe('E2E test run');
        });
    });
  });
});
