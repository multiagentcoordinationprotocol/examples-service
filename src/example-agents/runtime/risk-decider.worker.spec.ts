import { BootstrapPayload } from '../../hosting/contracts/bootstrap.types';

// ── SDK mocks ────────────────────────────────────────────────────────
const mockRun = jest.fn().mockResolvedValue(undefined);
const mockStop = jest.fn().mockResolvedValue(undefined);
const mockOn = jest.fn();
const mockOnTerminal = jest.fn();
const mockActions = {
  vote: jest.fn().mockResolvedValue(undefined),
  commit: jest.fn().mockResolvedValue(undefined),
  evaluate: jest.fn().mockResolvedValue(undefined),
  cancelSession: jest.fn()
};

jest.mock('macp-sdk-typescript', () => ({
  agent: {
    fromBootstrap: jest.fn(() => ({
      run: mockRun,
      stop: mockStop,
      on: mockOn,
      onTerminal: mockOnTerminal,
      actions: mockActions
    }))
  }
}));

// ── worker-side mocks ────────────────────────────────────────────────
const mockLoadBootstrap = jest.fn();
const mockStartCancelServer = jest.fn((..._args: unknown[]) =>
  Promise.resolve({ address: 'http://127.0.0.1:0/agent/cancel', close: () => Promise.resolve() })
);

jest.mock('./bootstrap-loader', () => ({
  loadBootstrapPayload: () => mockLoadBootstrap(),
  hasDirectRuntimeIdentity: (b: BootstrapPayload) => Boolean(b.runtime_url && b.auth_token),
  isInitiator: (b: BootstrapPayload) => Boolean(b.initiator)
}));

jest.mock('./cancel-callback-server', () => ({
  startCancelCallbackServer: (opts: unknown) => mockStartCancelServer(opts)
}));

// ── helpers ─────────────────────────────────────────────────────────
function defaultBootstrap(overrides: Partial<BootstrapPayload> = {}): BootstrapPayload {
  return {
    participant_id: 'risk-coordinator',
    agent_id: 'risk-agent',
    session_id: 'sess-uuid-v4',
    mode: 'macp.mode.decision.v1',
    runtime_url: 'runtime.local:50051',
    auth_token: 'tok-risk',
    secure: true,
    allow_insecure: false,
    participants: ['risk-coordinator', 'fraud-agent', 'compliance-agent'],
    mode_version: '1.0.0',
    configuration_version: 'config.default',
    policy_version: 'policy.fraud.majority-veto',
    cancel_callback: { host: '127.0.0.1', port: 0, path: '/agent/cancel' },
    metadata: {
      run_id: 'run-1',
      trace_id: 'trace-1',
      scenario_ref: 'fraud/high-value-new-device@1.0.0',
      role: 'coordinator',
      framework: 'custom',
      agent_ref: 'risk-agent',
      policy_hints: { type: 'majority', threshold: 0.5, vetoEnabled: false },
      session_context: { transactionAmount: 5000 }
    },
    ...overrides
  };
}

async function runWorker(): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    jest.isolateModules(() => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('./risk-decider.worker');
      } catch (e) {
        reject(e);
      }
    });
    setTimeout(resolve, 200);
  });
}

// ── tests ───────────────────────────────────────────────────────────
describe('risk-decider.worker (SDK Participant)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers({ advanceTimers: true });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('starts cancel-callback server when bootstrap has cancel_callback', async () => {
    mockLoadBootstrap.mockReturnValue(defaultBootstrap());

    await runWorker();
    await jest.advanceTimersByTimeAsync(500);

    expect(mockStartCancelServer).toHaveBeenCalledWith(
      expect.objectContaining({ host: '127.0.0.1', path: '/agent/cancel' })
    );
  });

  it('registers Proposal, Evaluation, and Objection handlers', async () => {
    mockLoadBootstrap.mockReturnValue(defaultBootstrap());

    await runWorker();
    await jest.advanceTimersByTimeAsync(500);

    const registeredTypes = mockOn.mock.calls.map((call: unknown[]) => call[0]);
    expect(registeredTypes).toContain('Proposal');
    expect(registeredTypes).toContain('Evaluation');
    expect(registeredTypes).toContain('Objection');
  });

  it('registers a terminal handler', async () => {
    mockLoadBootstrap.mockReturnValue(defaultBootstrap());

    await runWorker();
    await jest.advanceTimersByTimeAsync(500);

    expect(mockOnTerminal).toHaveBeenCalled();
  });

  it('calls participant.run()', async () => {
    mockLoadBootstrap.mockReturnValue(defaultBootstrap());

    await runWorker();
    await jest.advanceTimersByTimeAsync(500);

    expect(mockRun).toHaveBeenCalled();
  });

  it('sets process.exitCode = 1 on unhandled error', async () => {
    mockLoadBootstrap.mockImplementation(() => {
      throw new Error('bootstrap missing');
    });

    const originalExitCode = process.exitCode;
    await runWorker();
    await jest.advanceTimersByTimeAsync(500);

    expect(process.exitCode).toBe(1);
    process.exitCode = originalExitCode;
  });
});
