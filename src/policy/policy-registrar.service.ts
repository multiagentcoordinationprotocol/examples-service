import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Auth, MacpClient } from 'macp-sdk-typescript';
import type { PolicyDescriptor as SdkPolicyDescriptor } from 'macp-sdk-typescript';
import { AppConfigService } from '../config/app-config.service';
import { AuthTokenMinterService } from '../auth/auth-token-minter.service';
import { PolicyLoaderService } from './policy-loader.service';
import type { PolicyDefinition } from '../contracts/policy';

const REGISTRAR_SENDER = 'examples-service';

@Injectable()
export class PolicyRegistrarService implements OnApplicationBootstrap {
  private readonly logger = new Logger(PolicyRegistrarService.name);

  constructor(
    private readonly config: AppConfigService,
    private readonly loader: PolicyLoaderService,
    private readonly minter: AuthTokenMinterService
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.registerPoliciesOnLaunch) {
      this.logger.log('REGISTER_POLICIES_ON_LAUNCH=false — skipping policy registration');
      return;
    }

    if (!this.config.runtimeAddress) {
      this.logger.warn('MACP_RUNTIME_ADDRESS unset — skipping policy registration; launches will fail');
      return;
    }

    const policies = this.loader.listRegistrablePolicies();
    if (policies.length === 0) {
      this.logger.warn('no policies to register');
      return;
    }

    let token: string;
    try {
      const minted = await this.minter.mintToken(REGISTRAR_SENDER, {
        can_manage_mode_registry: true,
        is_observer: false,
        allowed_modes: ['*']
      });
      token = minted.token;
    } catch (err) {
      this.logger.error(
        `policy registration aborted: failed to mint admin JWT — launches will fail with UNKNOWN_POLICY_VERSION. ${err instanceof Error ? err.message : String(err)}`
      );
      return;
    }

    const client = new MacpClient({
      address: this.config.runtimeAddress,
      secure: this.config.runtimeTls,
      allowInsecure: this.config.runtimeAllowInsecure,
      auth: Auth.bearer(token, { expectedSender: REGISTRAR_SENDER })
    });

    let registered = 0;
    let already = 0;
    let failed = 0;

    for (const policy of policies) {
      const descriptor = this.toDescriptor(policy);
      try {
        const result = await client.registerPolicy(descriptor);
        if (result.ok) {
          registered += 1;
          this.logger.log(`policy_registered policy_id=${policy.policy_id} mode=${policy.mode}`);
        } else if (this.isAlreadyRegisteredError(result.error)) {
          already += 1;
          this.logger.log(`policy_already_registered policy_id=${policy.policy_id}`);
        } else {
          failed += 1;
          this.logger.warn(`policy_register_failed policy_id=${policy.policy_id} error=${result.error ?? 'unknown'}`);
        }
      } catch (err) {
        failed += 1;
        this.logger.warn(
          `policy_register_exception policy_id=${policy.policy_id} ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    this.logger.log(
      `policy_registration_complete registered=${registered} already=${already} failed=${failed} total=${policies.length}`
    );
  }

  private toDescriptor(policy: PolicyDefinition): SdkPolicyDescriptor {
    return {
      policyId: policy.policy_id,
      mode: policy.mode,
      description: policy.description ?? '',
      rules: JSON.stringify(policy.rules),
      schemaVersion: policy.schema_version
    };
  }

  private isAlreadyRegisteredError(error: string | undefined): boolean {
    if (!error) return false;
    return error.toLowerCase().includes('already');
  }
}
