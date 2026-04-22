import { Global, Module } from '@nestjs/common';
import { AuthTokenMinterService } from './auth-token-minter.service';

/**
 * AUTH-2 — exposes {@link AuthTokenMinterService} app-wide so the hosting
 * provider can mint short-lived JWTs for spawned agents. Depends on
 * `AppConfigService` (provided globally by `ConfigModule`).
 */
@Global()
@Module({
  providers: [AuthTokenMinterService],
  exports: [AuthTokenMinterService]
})
export class AuthModule {}
