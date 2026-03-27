import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly config: AppConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const keys = this.config.authApiKeys;
    if (!keys || keys.length === 0) return true;

    const request = context.switchToHttp().getRequest();
    const header = request.headers['x-api-key'] as string | undefined;

    if (!header || !keys.includes(header)) {
      throw new UnauthorizedException('Invalid or missing API key');
    }

    return true;
  }
}
