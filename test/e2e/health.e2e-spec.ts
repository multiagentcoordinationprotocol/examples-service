import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import * as path from 'path';
import { AppModule } from '../../src/app.module';
import { AppConfigService } from '../../src/config/app-config.service';

describe('Health (e2e)', () => {
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
        isDevelopment: false,
        port: 0,
        host: '0.0.0.0',
        logLevel: 'error'
      })
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /healthz', () => {
    it('should return ok', () => {
      return request(app.getHttpServer())
        .get('/healthz')
        .expect(200)
        .expect((res: any) => {
          expect(res.body.ok).toBe(true);
          expect(res.body.service).toBe('scenario-registry');
        });
    });
  });
});
