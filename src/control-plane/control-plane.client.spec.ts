import { HttpStatus } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import { ControlPlaneClient } from './control-plane.client';
import { AppException } from '../errors/app-exception';
import { ErrorCode } from '../errors/error-codes';
import { ExecutionRequest } from '../contracts/launch';

const mockRequest: ExecutionRequest = {
  mode: 'sandbox',
  runtime: { kind: 'rust', version: 'v1' },
  session: {
    modeName: 'test.mode',
    modeVersion: '1.0.0',
    configurationVersion: 'config.default',
    ttlMs: 300000,
    participants: []
  }
};

describe('ControlPlaneClient', () => {
  let client: ControlPlaneClient;
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    const config = {
      controlPlaneBaseUrl: 'http://localhost:3001',
      controlPlaneApiKey: undefined,
      controlPlaneTimeoutMs: 5000
    } as AppConfigService;
    client = new ControlPlaneClient(config);
    fetchSpy = jest.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  describe('baseUrl', () => {
    it('should return the configured base URL', () => {
      expect(client.baseUrl).toBe('http://localhost:3001');
    });
  });

  describe('validate', () => {
    it('should POST to /runs/validate', async () => {
      fetchSpy.mockResolvedValue({ ok: true, status: HttpStatus.NO_CONTENT });
      await client.validate(mockRequest);
      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3001/runs/validate',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should throw CONTROL_PLANE_UNAVAILABLE on non-ok response', async () => {
      fetchSpy.mockResolvedValue({ ok: false, status: 500, text: async () => 'server error' });
      await expect(client.validate(mockRequest)).rejects.toThrow(AppException);
      try {
        await client.validate(mockRequest);
      } catch (err) {
        expect((err as AppException).errorCode).toBe(ErrorCode.CONTROL_PLANE_UNAVAILABLE);
      }
    });

    it('should throw CONTROL_PLANE_UNAVAILABLE on network error', async () => {
      fetchSpy.mockRejectedValue(new Error('ECONNREFUSED'));
      await expect(client.validate(mockRequest)).rejects.toThrow(AppException);
    });
  });

  describe('createRun', () => {
    it('should POST to /runs and return run data', async () => {
      const runResponse = { runId: 'run-1', status: 'queued', traceId: 'trace-1' };
      fetchSpy.mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => runResponse
      });
      const result = await client.createRun(mockRequest);
      expect(result).toEqual(runResponse);
    });
  });

  describe('authorization', () => {
    it('should include Bearer token when API key is configured', async () => {
      const config = {
        controlPlaneBaseUrl: 'http://localhost:3001',
        controlPlaneApiKey: 'test-key',
        controlPlaneTimeoutMs: 5000
      } as AppConfigService;
      const authedClient = new ControlPlaneClient(config);

      fetchSpy.mockResolvedValue({ ok: true, status: HttpStatus.NO_CONTENT });
      await authedClient.validate(mockRequest);

      expect(fetchSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({ authorization: 'Bearer test-key' })
        })
      );
    });
  });
});
