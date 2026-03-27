import { Injectable, HttpStatus } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import { ExecutionRequest } from '../contracts/launch';
import { AppException } from '../errors/app-exception';
import { ErrorCode } from '../errors/error-codes';

interface ControlPlaneRunResponse {
  runId: string;
  status: string;
  traceId?: string;
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
    return this.request<ControlPlaneRunResponse>('/runs', request);
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
        throw new AppException(
          ErrorCode.CONTROL_PLANE_UNAVAILABLE,
          `control plane request failed (${response.status}): ${text}`,
          response.status >= 400 && response.status < 600 ? response.status : HttpStatus.BAD_GATEWAY
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
