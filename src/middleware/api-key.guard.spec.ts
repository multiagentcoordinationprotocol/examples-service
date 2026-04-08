import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ApiKeyGuard } from './api-key.guard';
import { AppConfigService } from '../config/app-config.service';

function createMockContext(headers: Record<string, string> = {}): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers })
    })
  } as unknown as ExecutionContext;
}

describe('ApiKeyGuard', () => {
  it('should allow all requests when no API keys are configured', () => {
    const config = { authApiKeys: [] } as unknown as AppConfigService;
    const guard = new ApiKeyGuard(config);

    expect(guard.canActivate(createMockContext())).toBe(true);
  });

  it('should allow requests with a valid API key', () => {
    const config = { authApiKeys: ['key-1', 'key-2'] } as unknown as AppConfigService;
    const guard = new ApiKeyGuard(config);

    expect(guard.canActivate(createMockContext({ 'x-api-key': 'key-1' }))).toBe(true);
  });

  it('should reject requests with an invalid API key', () => {
    const config = { authApiKeys: ['key-1'] } as unknown as AppConfigService;
    const guard = new ApiKeyGuard(config);

    expect(() => guard.canActivate(createMockContext({ 'x-api-key': 'wrong' }))).toThrow(UnauthorizedException);
  });

  it('should reject requests with no API key header when keys are required', () => {
    const config = { authApiKeys: ['key-1'] } as unknown as AppConfigService;
    const guard = new ApiKeyGuard(config);

    expect(() => guard.canActivate(createMockContext())).toThrow(UnauthorizedException);
  });
});
