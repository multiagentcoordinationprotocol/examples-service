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

    it('should throw CONTROL_PLANE_ERROR on non-ok response', async () => {
      fetchSpy.mockResolvedValue({ ok: false, status: 500, text: async () => 'server error' });
      await expect(client.validate(mockRequest)).rejects.toThrow(AppException);
      try {
        await client.validate(mockRequest);
      } catch (err) {
        expect((err as AppException).errorCode).toBe(ErrorCode.CONTROL_PLANE_ERROR);
      }
    });

    it('should parse structured error response with reasons', async () => {
      const errorBody = JSON.stringify({
        statusCode: 400,
        error: 'VALIDATION_ERROR',
        message: 'invalid request',
        reasons: ['missing field X', 'invalid value Y']
      });
      fetchSpy.mockResolvedValue({ ok: false, status: 400, text: async () => errorBody });
      try {
        await client.validate(mockRequest);
      } catch (err) {
        const appErr = err as AppException;
        expect(appErr.message).toBe('invalid request');
        expect(appErr.metadata).toEqual(
          expect.objectContaining({ reasons: ['missing field X', 'invalid value Y'] })
        );
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

  describe('createRun — 409 Conflict', () => {
    it('should return existing run data on 409 (idempotent)', async () => {
      const existing = { runId: 'run-existing', status: 'active', traceId: 'trace-2' };
      fetchSpy.mockResolvedValue({
        ok: false,
        status: 409,
        text: async () => JSON.stringify(existing)
      });
      const result = await client.createRun(mockRequest);
      expect(result).toEqual(existing);
    });
  });

  describe('registerPolicy', () => {
    it('should POST to /runtime/policies and return ok', async () => {
      fetchSpy.mockResolvedValue({ ok: true, status: 201, json: async () => ({}) });
      const result = await client.registerPolicy({
        policy_id: 'policy.test',
        mode: 'test',
        schema_version: 1,
        description: 'test',
        rules: {
          voting: { algorithm: 'none' },
          objection_handling: { critical_severity_vetoes: false, veto_threshold: 1 },
          evaluation: { minimum_confidence: 0, required_before_voting: false },
          commitment: { authority: 'initiator_only', require_vote_quorum: false, designated_roles: [] }
        }
      });
      expect(result.ok).toBe(true);
      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3001/runtime/policies',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should return ok=true on POLICY_ALREADY_EXISTS error', async () => {
      const errorBody = JSON.stringify({ error: 'POLICY_ALREADY_EXISTS', message: 'already exists' });
      fetchSpy.mockResolvedValue({ ok: false, status: 409, text: async () => errorBody });
      const result = await client.registerPolicy({
        policy_id: 'policy.test',
        mode: 'test',
        schema_version: 1,
        description: 'test',
        rules: {
          voting: { algorithm: 'none' },
          objection_handling: { critical_severity_vetoes: false, veto_threshold: 1 },
          evaluation: { minimum_confidence: 0, required_before_voting: false },
          commitment: { authority: 'initiator_only', require_vote_quorum: false, designated_roles: [] }
        }
      });
      expect(result.ok).toBe(true);
    });

    it('should return ok=false on other errors', async () => {
      fetchSpy.mockRejectedValue(new Error('network error'));
      const result = await client.registerPolicy({
        policy_id: 'policy.test',
        mode: 'test',
        schema_version: 1,
        description: 'test',
        rules: {
          voting: { algorithm: 'none' },
          objection_handling: { critical_severity_vetoes: false, veto_threshold: 1 },
          evaluation: { minimum_confidence: 0, required_before_voting: false },
          commitment: { authority: 'initiator_only', require_vote_quorum: false, designated_roles: [] }
        }
      });
      expect(result.ok).toBe(false);
      expect(result.error).toContain('network error');
    });
  });

  describe('listPolicies', () => {
    it('should GET /runtime/policies and return array', async () => {
      const policies = [
        { policy_id: 'policy.fraud.unanimous', mode: 'decision', schema_version: 1 }
      ];
      fetchSpy.mockResolvedValue({ ok: true, status: 200, json: async () => policies });
      const result = await client.listPolicies();
      expect(result).toEqual(policies);
      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3001/runtime/policies',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('should pass mode query parameter when provided', async () => {
      fetchSpy.mockResolvedValue({ ok: true, status: 200, json: async () => [] });
      await client.listPolicies('macp.mode.decision.v1');
      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3001/runtime/policies?mode=macp.mode.decision.v1',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('should throw CONTROL_PLANE_ERROR on non-ok response', async () => {
      const errorBody = JSON.stringify({
        statusCode: 500,
        error: 'INTERNAL_ERROR',
        message: 'database unavailable'
      });
      fetchSpy.mockResolvedValue({ ok: false, status: 500, text: async () => errorBody });
      await expect(client.listPolicies()).rejects.toThrow(AppException);
      try {
        await client.listPolicies();
      } catch (err) {
        expect((err as AppException).errorCode).toBe(ErrorCode.CONTROL_PLANE_ERROR);
        expect((err as AppException).message).toBe('database unavailable');
      }
    });

    it('should throw CONTROL_PLANE_UNAVAILABLE on network error', async () => {
      fetchSpy.mockRejectedValue(new Error('ECONNREFUSED'));
      await expect(client.listPolicies()).rejects.toThrow(AppException);
      try {
        await client.listPolicies();
      } catch (err) {
        expect((err as AppException).errorCode).toBe(ErrorCode.CONTROL_PLANE_UNAVAILABLE);
      }
    });
  });

  describe('getPolicy', () => {
    it('should GET /runtime/policies/:id and return policy', async () => {
      const policy = { policy_id: 'policy.fraud.unanimous', mode: 'decision', schema_version: 1 };
      fetchSpy.mockResolvedValue({ ok: true, status: 200, json: async () => policy });
      const result = await client.getPolicy('policy.fraud.unanimous');
      expect(result).toEqual(policy);
      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3001/runtime/policies/policy.fraud.unanimous',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('should throw on 404 when policy not found', async () => {
      const errorBody = JSON.stringify({
        statusCode: 404,
        error: 'POLICY_NOT_FOUND',
        message: 'policy not found'
      });
      fetchSpy.mockResolvedValue({ ok: false, status: 404, text: async () => errorBody });
      await expect(client.getPolicy('policy.unknown')).rejects.toThrow(AppException);
      try {
        await client.getPolicy('policy.unknown');
      } catch (err) {
        expect((err as AppException).errorCode).toBe(ErrorCode.CONTROL_PLANE_ERROR);
        expect((err as AppException).message).toBe('policy not found');
      }
    });
  });

  describe('deletePolicy', () => {
    it('should DELETE /runtime/policies/:id and return ok', async () => {
      fetchSpy.mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });
      const result = await client.deletePolicy('policy.fraud.unanimous');
      expect(result).toEqual({ ok: true });
      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost:3001/runtime/policies/policy.fraud.unanimous',
        expect.objectContaining({ method: 'DELETE' })
      );
    });

    it('should throw on 404 when policy not found', async () => {
      const errorBody = JSON.stringify({
        statusCode: 404,
        error: 'POLICY_NOT_FOUND',
        message: 'policy not found'
      });
      fetchSpy.mockResolvedValue({ ok: false, status: 404, text: async () => errorBody });
      await expect(client.deletePolicy('policy.unknown')).rejects.toThrow(AppException);
    });

    it('should parse structured error with reasons on failure', async () => {
      const errorBody = JSON.stringify({
        statusCode: 403,
        error: 'FORBIDDEN',
        message: 'cannot delete active policy',
        reasons: ['policy is referenced by 3 active sessions']
      });
      fetchSpy.mockResolvedValue({ ok: false, status: 403, text: async () => errorBody });
      try {
        await client.deletePolicy('policy.fraud.unanimous');
      } catch (err) {
        const appErr = err as AppException;
        expect(appErr.message).toBe('cannot delete active policy');
        expect(appErr.metadata).toEqual(
          expect.objectContaining({ reasons: ['policy is referenced by 3 active sessions'] })
        );
      }
    });

    it('should throw CONTROL_PLANE_UNAVAILABLE on network error', async () => {
      fetchSpy.mockRejectedValue(new Error('ECONNREFUSED'));
      await expect(client.deletePolicy('policy.test')).rejects.toThrow(AppException);
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
