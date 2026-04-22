import { PolicyRegistrarService } from './policy-registrar.service';
import { PolicyLoaderService } from './policy-loader.service';
import { AuthTokenMinterService } from '../auth/auth-token-minter.service';
import { AppConfigService } from '../config/app-config.service';
import type { PolicyDefinition } from '../contracts/policy';

const registerPolicyMock = jest.fn();
const macpClientCtor = jest.fn();

jest.mock('macp-sdk-typescript', () => ({
  Auth: {
    bearer: (token: string, options?: { expectedSender?: string }) => ({
      bearerToken: token,
      expectedSender: options?.expectedSender
    })
  },
  MacpClient: jest.fn().mockImplementation((opts: unknown) => {
    macpClientCtor(opts);
    return { registerPolicy: registerPolicyMock };
  })
}));

const claimsPolicy: PolicyDefinition = {
  policy_id: 'policy.claims.majority',
  mode: 'macp.mode.decision.v1',
  schema_version: 1,
  description: 'Claims majority',
  rules: {
    voting: { algorithm: 'majority', threshold: 0.5, quorum: { type: 'count', value: 2 } },
    objection_handling: { critical_severity_vetoes: false, veto_threshold: 1 },
    evaluation: { minimum_confidence: 0, required_before_voting: false },
    commitment: { authority: 'initiator_only', require_vote_quorum: true, designated_roles: [] }
  }
};

const fraudPolicy: PolicyDefinition = {
  ...claimsPolicy,
  policy_id: 'policy.fraud.unanimous',
  description: 'Fraud unanimous'
};

function buildService(overrides: {
  registerPoliciesOnLaunch?: boolean;
  runtimeAddress?: string;
  policies?: PolicyDefinition[];
  mint?: () => Promise<{ token: string; sender: string; expiresAt: number; expiresInSeconds: number; cacheOutcome: 'hit' | 'miss' }>;
} = {}) {
  const config = {
    registerPoliciesOnLaunch: overrides.registerPoliciesOnLaunch ?? true,
    runtimeAddress: overrides.runtimeAddress ?? 'runtime:50051',
    runtimeTls: false,
    runtimeAllowInsecure: true
  } as unknown as AppConfigService;

  const loader = {
    listRegistrablePolicies: jest.fn().mockReturnValue(overrides.policies ?? [claimsPolicy, fraudPolicy])
  } as unknown as PolicyLoaderService;

  const minter = {
    mintToken:
      overrides.mint ??
      jest.fn().mockResolvedValue({
        token: 'jwt-admin',
        sender: 'examples-service',
        expiresAt: Date.now() + 3_600_000,
        expiresInSeconds: 3600,
        cacheOutcome: 'miss'
      })
  } as unknown as AuthTokenMinterService;

  return { service: new PolicyRegistrarService(config, loader, minter), config, loader, minter };
}

describe('PolicyRegistrarService', () => {
  beforeEach(() => {
    registerPolicyMock.mockReset();
    macpClientCtor.mockReset();
  });

  it('skips when registerPoliciesOnLaunch is false', async () => {
    const { service, minter } = buildService({ registerPoliciesOnLaunch: false });
    await service.onApplicationBootstrap();
    expect(minter.mintToken).not.toHaveBeenCalled();
    expect(macpClientCtor).not.toHaveBeenCalled();
  });

  it('skips when runtime address is unset', async () => {
    const { service, minter } = buildService({ runtimeAddress: '' });
    await service.onApplicationBootstrap();
    expect(minter.mintToken).not.toHaveBeenCalled();
  });

  it('skips when no registrable policies are loaded', async () => {
    const { service, minter } = buildService({ policies: [] });
    await service.onApplicationBootstrap();
    expect(minter.mintToken).not.toHaveBeenCalled();
  });

  it('aborts cleanly when minting fails', async () => {
    const { service } = buildService({
      mint: jest.fn().mockRejectedValue(new Error('auth-service down'))
    });
    await service.onApplicationBootstrap();
    expect(macpClientCtor).not.toHaveBeenCalled();
    expect(registerPolicyMock).not.toHaveBeenCalled();
  });

  it('mints with management scope for the examples-service sender', async () => {
    const { service, minter } = buildService();
    registerPolicyMock.mockResolvedValue({ ok: true });
    await service.onApplicationBootstrap();
    expect(minter.mintToken).toHaveBeenCalledWith('examples-service', {
      can_manage_mode_registry: true,
      is_observer: false,
      allowed_modes: ['*']
    });
  });

  it('constructs MacpClient with runtime address and bearer auth', async () => {
    const { service } = buildService();
    registerPolicyMock.mockResolvedValue({ ok: true });
    await service.onApplicationBootstrap();
    expect(macpClientCtor).toHaveBeenCalledWith({
      address: 'runtime:50051',
      secure: false,
      allowInsecure: true,
      auth: { bearerToken: 'jwt-admin', expectedSender: 'examples-service' }
    });
  });

  it('maps PolicyDefinition fields and stringifies rules into PolicyDescriptor', async () => {
    const { service } = buildService({ policies: [claimsPolicy] });
    registerPolicyMock.mockResolvedValue({ ok: true });
    await service.onApplicationBootstrap();
    expect(registerPolicyMock).toHaveBeenCalledTimes(1);
    expect(registerPolicyMock).toHaveBeenCalledWith({
      policyId: 'policy.claims.majority',
      mode: 'macp.mode.decision.v1',
      description: 'Claims majority',
      rules: JSON.stringify(claimsPolicy.rules),
      schemaVersion: 1
    });
  });

  it('registers every policy returned by the loader', async () => {
    const { service } = buildService({ policies: [claimsPolicy, fraudPolicy] });
    registerPolicyMock.mockResolvedValue({ ok: true });
    await service.onApplicationBootstrap();
    expect(registerPolicyMock).toHaveBeenCalledTimes(2);
  });

  it('treats "already registered" errors as success and continues', async () => {
    const { service } = buildService({ policies: [claimsPolicy, fraudPolicy] });
    registerPolicyMock
      .mockResolvedValueOnce({ ok: false, error: 'policy with id policy.claims.majority already exists' })
      .mockResolvedValueOnce({ ok: true });
    await service.onApplicationBootstrap();
    expect(registerPolicyMock).toHaveBeenCalledTimes(2);
  });

  it('continues registering remaining policies when one throws', async () => {
    const { service } = buildService({ policies: [claimsPolicy, fraudPolicy] });
    registerPolicyMock
      .mockRejectedValueOnce(new Error('grpc UNAVAILABLE'))
      .mockResolvedValueOnce({ ok: true });
    await service.onApplicationBootstrap();
    expect(registerPolicyMock).toHaveBeenCalledTimes(2);
  });
});
