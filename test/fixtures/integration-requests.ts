export interface CompileRequest {
  scenarioRef: string;
  templateId?: string;
  mode?: 'live' | 'sandbox';
  inputs: Record<string, unknown>;
}

export interface RunExampleRequest extends CompileRequest {
  bootstrapAgents?: boolean;
  submitToControlPlane?: boolean;
}

export function fraudScenarioCompileRequest(overrides?: Partial<CompileRequest>): CompileRequest {
  return {
    scenarioRef: 'fraud/high-value-new-device@1.0.0',
    templateId: 'default',
    mode: 'sandbox',
    inputs: {
      transactionAmount: 3200,
      deviceTrustScore: 0.12,
      accountAgeDays: 5,
      isVipCustomer: true,
      priorChargebacks: 1
    },
    ...overrides
  };
}

export function fraudScenarioRunRequest(overrides?: Partial<RunExampleRequest>): RunExampleRequest {
  return {
    ...fraudScenarioCompileRequest(),
    submitToControlPlane: true,
    bootstrapAgents: true,
    ...overrides
  };
}

export function lendingScenarioCompileRequest(overrides?: Partial<CompileRequest>): CompileRequest {
  return {
    scenarioRef: 'lending/loan-underwriting@1.0.0',
    templateId: 'default',
    mode: 'sandbox',
    inputs: {
      loanAmount: 25000,
      creditScore: 680,
      debtToIncomeRatio: 0.35,
      employmentYears: 3,
      isExistingCustomer: true,
      priorDefaults: 0
    },
    ...overrides
  };
}

export function lendingScenarioRunRequest(overrides?: Partial<RunExampleRequest>): RunExampleRequest {
  return {
    ...lendingScenarioCompileRequest(),
    submitToControlPlane: true,
    bootstrapAgents: true,
    ...overrides
  };
}

export function claimsScenarioCompileRequest(overrides?: Partial<CompileRequest>): CompileRequest {
  return {
    scenarioRef: 'claims/auto-claim-review@1.0.0',
    templateId: 'default',
    mode: 'sandbox',
    inputs: {
      claimAmount: 8500,
      policyAge: 24,
      priorClaims: 1,
      isHighValuePolicy: false,
      incidentSeverity: 'moderate'
    },
    ...overrides
  };
}

export function claimsScenarioRunRequest(overrides?: Partial<RunExampleRequest>): RunExampleRequest {
  return {
    ...claimsScenarioCompileRequest(),
    submitToControlPlane: true,
    bootstrapAgents: true,
    ...overrides
  };
}
