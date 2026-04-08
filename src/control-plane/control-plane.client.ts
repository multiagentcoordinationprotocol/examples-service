import { Injectable, HttpStatus } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import { ExecutionRequest } from '../contracts/launch';
import {
  PolicyDefinition,
  PolicyDescriptor,
  RunStateProjection,
  ControlPlaneErrorResponse
} from '../contracts/policy';
import { AppException } from '../errors/app-exception';
import { ErrorCode } from '../errors/error-codes';

interface ControlPlaneRunResponse {
  runId: string;
  status: string;
  traceId?: string;
}

export interface AgentMetricsEntry {
  participantId: string;
  runs: number;
  signals: number;
  messages: number;
  averageConfidence: number;
}

@Injectable()
export class ControlPlaneClient {
  constructor(private readonly config: AppConfigService) {}

  get baseUrl(): string {
    return this.config.controlPlaneBaseUrl;
  }

  async validate(request: ExecutionRequest): Promise<void> {
    await this.request('/runs/validate', request);
  }

  async createRun(request: ExecutionRequest): Promise<ControlPlaneRunResponse> {
    return this.requestWithConflict<ControlPlaneRunResponse>('/runs', request);
  }

  async getRunState(runId: string): Promise<RunStateProjection> {
    return this.get<RunStateProjection>(`/runs/${runId}/state`);
  }

  async getAgentMetrics(): Promise<AgentMetricsEntry[]> {
    return this.get<AgentMetricsEntry[]>('/dashboard/agents/metrics');
  }

  async registerPolicy(policy: PolicyDefinition): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.request('/runtime/policies', policy);
      return { ok: true };
    } catch (error) {
      if (error instanceof AppException) {
        const meta = error.metadata as Record<string, unknown> | undefined;
        if (meta?.error === 'POLICY_ALREADY_EXISTS') {
          return { ok: true };
        }
        return { ok: false, error: error.message };
      }
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async listPolicies(mode?: string): Promise<PolicyDescriptor[]> {
    const query = mode ? `?mode=${encodeURIComponent(mode)}` : '';
    return this.get<PolicyDescriptor[]>(`/runtime/policies${query}`);
  }

  async getPolicy(policyId: string): Promise<PolicyDescriptor> {
    return this.get<PolicyDescriptor>(`/runtime/policies/${encodeURIComponent(policyId)}`);
  }

  async deletePolicy(policyId: string): Promise<{ ok: boolean }> {
    return this.del(`/runtime/policies/${encodeURIComponent(policyId)}`);
  }

  private async get<T>(path: string): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.controlPlaneTimeoutMs);
    try {
      const response = await fetch(`${this.config.controlPlaneBaseUrl}${path}`, {
        method: 'GET',
        headers: {
          ...(this.config.controlPlaneApiKey
            ? { authorization: `Bearer ${this.config.controlPlaneApiKey}` }
            : {})
        },
        signal: controller.signal
      });
      if (!response.ok) {
        const text = await response.text();
        let parsed: ControlPlaneErrorResponse | undefined;
        try {
          parsed = JSON.parse(text) as ControlPlaneErrorResponse;
        } catch {
          // not JSON
        }
        throw new AppException(
          ErrorCode.CONTROL_PLANE_ERROR,
          parsed?.message ?? `control plane GET ${path} failed (${response.status})`,
          response.status >= 400 && response.status < 600 ? response.status : HttpStatus.BAD_GATEWAY,
          { reasons: parsed?.reasons, error: parsed?.error }
        );
      }
      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof AppException) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new AppException(
        ErrorCode.CONTROL_PLANE_UNAVAILABLE,
        `control plane GET ${path} failed: ${message}`,
        HttpStatus.BAD_GATEWAY
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private async del(path: string): Promise<{ ok: boolean }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.controlPlaneTimeoutMs);
    try {
      const response = await fetch(`${this.config.controlPlaneBaseUrl}${path}`, {
        method: 'DELETE',
        headers: {
          ...(this.config.controlPlaneApiKey
            ? { authorization: `Bearer ${this.config.controlPlaneApiKey}` }
            : {})
        },
        signal: controller.signal
      });
      if (!response.ok) {
        const text = await response.text();
        let parsed: ControlPlaneErrorResponse | undefined;
        try {
          parsed = JSON.parse(text) as ControlPlaneErrorResponse;
        } catch {
          // not JSON
        }
        throw new AppException(
          ErrorCode.CONTROL_PLANE_ERROR,
          parsed?.message ?? `control plane DELETE ${path} failed (${response.status})`,
          response.status >= 400 && response.status < 600 ? response.status : HttpStatus.BAD_GATEWAY,
          { reasons: parsed?.reasons, error: parsed?.error }
        );
      }
      return { ok: true };
    } catch (error) {
      if (error instanceof AppException) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new AppException(
        ErrorCode.CONTROL_PLANE_UNAVAILABLE,
        `control plane DELETE ${path} failed: ${message}`,
        HttpStatus.BAD_GATEWAY
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private async requestWithConflict<T>(path: string, body: unknown): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.controlPlaneTimeoutMs);

    try {
      const response = await fetch(`${this.config.controlPlaneBaseUrl}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.config.controlPlaneApiKey
            ? { authorization: `Bearer ${this.config.controlPlaneApiKey}` }
            : {})
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      if (response.status === HttpStatus.CONFLICT) {
        const text = await response.text();
        try {
          return JSON.parse(text) as T;
        } catch {
          return undefined as T;
        }
      }

      if (!response.ok) {
        const text = await response.text();
        let parsed: ControlPlaneErrorResponse | undefined;
        try {
          parsed = JSON.parse(text) as ControlPlaneErrorResponse;
        } catch {
          // not JSON
        }
        throw new AppException(
          ErrorCode.CONTROL_PLANE_ERROR,
          parsed?.message ?? `control plane request failed (${response.status}): ${text}`,
          response.status >= 400 && response.status < 600 ? response.status : HttpStatus.BAD_GATEWAY,
          { reasons: parsed?.reasons, error: parsed?.error }
        );
      }

      if (response.status === HttpStatus.NO_CONTENT) {
        return undefined as T;
      }

      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof AppException) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new AppException(
        ErrorCode.CONTROL_PLANE_UNAVAILABLE,
        `control plane request failed: ${message}`,
        HttpStatus.BAD_GATEWAY
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private async request<T = void>(path: string, body: unknown): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.controlPlaneTimeoutMs);

    try {
      const response = await fetch(`${this.config.controlPlaneBaseUrl}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.config.controlPlaneApiKey
            ? { authorization: `Bearer ${this.config.controlPlaneApiKey}` }
            : {})
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      if (!response.ok) {
        const text = await response.text();
        let parsed: ControlPlaneErrorResponse | undefined;
        try {
          parsed = JSON.parse(text) as ControlPlaneErrorResponse;
        } catch {
          // not JSON
        }
        throw new AppException(
          ErrorCode.CONTROL_PLANE_ERROR,
          parsed?.message ?? `control plane request failed (${response.status}): ${text}`,
          response.status >= 400 && response.status < 600 ? response.status : HttpStatus.BAD_GATEWAY,
          { reasons: parsed?.reasons, error: parsed?.error }
        );
      }

      if (response.status === HttpStatus.NO_CONTENT) {
        return undefined as T;
      }

      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof AppException) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new AppException(
        ErrorCode.CONTROL_PLANE_UNAVAILABLE,
        `control plane request failed: ${message}`,
        HttpStatus.BAD_GATEWAY
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}
