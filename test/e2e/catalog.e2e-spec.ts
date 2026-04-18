import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { AppConfigService } from '../../src/config/app-config.service';
import { GlobalExceptionFilter } from '../../src/errors/exception.filter';
import { buildE2eConfig } from './e2e-config';

describe('Catalog (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule]
    })
      .overrideProvider(AppConfigService)
      .useValue(buildE2eConfig())
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalFilters(new GlobalExceptionFilter());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /packs', () => {
    it('should return available packs', () => {
      return request(app.getHttpServer())
        .get('/packs')
        .expect(200)
        .expect((res: any) => {
          expect(Array.isArray(res.body)).toBe(true);
          expect(res.body.length).toBeGreaterThanOrEqual(1);
          const fraud = res.body.find((p: { slug: string }) => p.slug === 'fraud');
          expect(fraud).toBeDefined();
          expect(fraud.name).toBe('Fraud');
        });
    });
  });

  describe('GET /packs/:packSlug/scenarios', () => {
    it('should return scenarios for fraud pack', () => {
      return request(app.getHttpServer())
        .get('/packs/fraud/scenarios')
        .expect(200)
        .expect((res: any) => {
          expect(Array.isArray(res.body)).toBe(true);
          expect(res.body.length).toBeGreaterThanOrEqual(1);
          const scenario = res.body.find((s: { scenario: string }) => s.scenario === 'high-value-new-device');
          expect(scenario).toBeDefined();
          expect(scenario.versions).toContain('1.0.0');
          expect(scenario.templates).toContain('default');
          expect(scenario.templates).toContain('strict-risk');
        });
    });

    it('should return 404 for nonexistent pack', () => {
      return request(app.getHttpServer())
        .get('/packs/nonexistent/scenarios')
        .expect(404)
        .expect((res: any) => {
          expect(res.body.errorCode).toBe('PACK_NOT_FOUND');
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
