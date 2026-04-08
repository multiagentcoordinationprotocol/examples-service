# Policy Authoring Guide

Policies define the governance rules that control how specialist agent signals (evaluations and objections) are aggregated into final decisions during MACP coordination runs. This guide explains how to create, configure, and connect policies to scenarios.

## Policy JSON Schema

Every policy is a JSON file in the `policies/` directory with the following structure:

```json
{
  "policy_id": "policy.<domain>.<variant>",
  "mode": "macp.mode.decision.v1",
  "schema_version": 1,
  "description": "Human-readable description of this policy",
  "rules": {
    "voting": { ... },
    "objection_handling": { ... },
    "evaluation": { ... },
    "commitment": { ... }
  }
}
```

### Top-Level Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `policy_id` | string | Yes | Unique identifier. Convention: `policy.<domain>.<variant>` |
| `mode` | string | Yes | Execution mode this policy applies to (e.g., `macp.mode.decision.v1`). Use `*` for the default policy. |
| `schema_version` | number | Yes | Must be `>= 1`. Tracks policy schema evolution. |
| `description` | string | Yes | Human-readable description shown in catalogs and logs. |

### `rules.voting`

Controls how agent evaluations are counted toward a decision.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `algorithm` | string | `"none"` | One of: `none`, `majority`, `supermajority`, `unanimous`, `weighted` |
| `threshold` | number | `0.5` | Approval ratio required (only for `majority`/`supermajority`). Must be `> 0.5` for `supermajority`. |
| `quorum` | object | - | Minimum participants needed: `{ "type": "count" \| "percentage", "value": number }` |
| `weights` | object | - | Participant weight map (only for `weighted` algorithm) |

### `rules.objection_handling`

Controls how objections from specialist agents affect the decision.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `critical_severity_vetoes` | boolean | `false` | Whether critical-severity objections can veto the decision |
| `veto_threshold` | number | `1` | Number of critical objections required to trigger a veto. Must be `>= 1`. |

### `rules.evaluation`

Controls confidence requirements for evaluations.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `minimum_confidence` | number | `0.0` | Evaluations below this confidence are disqualified from voting. Range: `0.0`-`1.0`. |
| `required_before_voting` | boolean | `false` | Whether evaluations must be received before voting can proceed |

### `rules.commitment`

Controls who can commit the final decision.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `authority` | string | `"initiator_only"` | Who can commit: `initiator_only`, `designated_roles`, or `any_participant` |
| `require_vote_quorum` | boolean | `false` | Whether vote quorum must be met before commitment |
| `designated_roles` | string[] | `[]` | Roles with commitment authority (required when `authority` is `designated_roles`) |

## Voting Algorithms

### `none` (default)

No structured voting. Any blocking signal (rejection or objection) triggers a decline. Used by `policy.default`.

### `majority`

Simple majority voting. Approves when the approval rate meets the `threshold` (default 50%).

```json
"voting": { "algorithm": "majority", "threshold": 0.5, "quorum": { "type": "count", "value": 2 } }
```

- Approval rate = approvals / effective total (excludes ABSTAIN votes)
- If approval rate >= threshold: **approve**
- If rejections + objections > approvals: **decline**
- Otherwise: **step_up** (escalate for additional review)

### `supermajority`

Like majority but requires a higher threshold (must be > 0.5, typically 0.67).

```json
"voting": { "algorithm": "supermajority", "threshold": 0.67, "quorum": { "type": "count", "value": 3 } }
```

### `unanimous`

All participants must approve. Any rejection or objection causes a decline.

```json
"voting": { "algorithm": "unanimous", "quorum": { "type": "percentage", "value": 1.0 } }
```

- All approve: **approve**
- Any rejection or objection: **decline**
- Mixed non-blocking signals: **step_up**
- Disqualified evaluations (below `minimum_confidence`): **step_up**

### `weighted`

Participants have different vote weights. Define weights in a participant-to-weight map. Note: weighted voting is defined in the schema but is not yet implemented in the agent SDKs.

## Objection Handling and Vetoes

When `critical_severity_vetoes` is `true`, critical-severity objections from any agent can veto the decision regardless of voting outcome. Only objections with `severity: "critical"` count toward vetoes (per RFC-MACP-0004). High, medium, and low severity objections do not trigger vetoes.

The `veto_threshold` controls how many critical objections are needed:

```json
"objection_handling": { "critical_severity_vetoes": true, "veto_threshold": 2 }
```

This requires **2** critical objections before a veto triggers — a single critical objection would not veto.

## Confidence Filtering

The `minimum_confidence` field filters out low-confidence evaluations. Evaluations with `confidence` below this threshold are disqualified — they don't count as approvals, rejections, or even abstentions.

```json
"evaluation": { "minimum_confidence": 0.7, "required_before_voting": true }
```

- Evaluations without an explicit `confidence` field default to `1.0` (always qualified).
- Disqualified evaluations are tracked separately and may trigger a `step_up` in unanimous policies.

## ABSTAIN Votes

Evaluations with `recommendation: "ABSTAIN"` are excluded from the voting ratio denominator. This prevents abstaining participants from diluting the approval rate:

- 1 approve + 1 abstain + 1 review out of 3 total → effective total = 2 → approval rate = 50%

If all participants abstain, the effective total is 0 and the approval rate is 0, resulting in a `step_up`.

## Included Policies

| Policy ID | Algorithm | Threshold | Quorum | Veto | Min Confidence |
|-----------|-----------|-----------|--------|------|----------------|
| `policy.default` | none | - | 0 | No | 0.0 |
| `policy.fraud.majority-veto` | majority | 50% | 2 count | Yes (1) | 0.0 |
| `policy.fraud.supermajority` | supermajority | 67% | 2 count | No | 0.0 |
| `policy.fraud.unanimous` | unanimous | - | 100% | Yes (1) | 0.7 |
| `policy.lending.conservative` | supermajority | 67% | 3 count | Yes (1) | 0.6 |
| `policy.claims.majority` | majority | 50% | 2 count | No | 0.0 |

## Connecting Policies to Scenarios

Policies are referenced in scenario templates via the `policyVersion` field:

```yaml
# In a scenario template (e.g., templates/unanimous.yaml)
spec:
  overrides:
    launch:
      policyVersion: policy.fraud.unanimous
      policyHints:
        type: unanimous
        threshold: 1.0
        vetoEnabled: true
        minimumConfidence: 0.7
        designatedRoles: []
```

The default template uses `policy.default` which requires no registration.

### Policy Hints

`policyHints` are a denormalized projection of policy rules passed to agents at bootstrap time. They include:

| Hint Field | Maps From |
|------------|-----------|
| `type` | `rules.voting.algorithm` |
| `threshold` | `rules.voting.threshold` |
| `vetoEnabled` | `rules.objection_handling.critical_severity_vetoes` |
| `vetoThreshold` | `rules.objection_handling.veto_threshold` |
| `minimumConfidence` | `rules.evaluation.minimum_confidence` |
| `designatedRoles` | `rules.commitment.designated_roles` |

## How Policies Are Loaded

`PolicyLoaderService` reads all `*.json` files from the `policies/` directory at startup:

1. Parses each JSON file and extracts `policy_id`
2. Validates the policy structure (non-blocking warnings for issues)
3. Caches policies in memory for subsequent requests
4. `policy.default` is excluded from the registrable set (auto-resolved by the runtime)

## How Policies Are Registered

When `REGISTER_POLICIES_ON_LAUNCH=true` (the default), the `ExampleRunService` automatically registers non-default policies with the control plane before creating a run:

1. Reads `policyVersion` from the compiled `ExecutionRequest`
2. Skips if `policy.default` or undefined
3. Loads the policy definition from `PolicyLoaderService`
4. POSTs to `/runtime/policies` on the control plane
5. Treats `409 POLICY_ALREADY_EXISTS` as success (idempotent)
6. Logs a warning on failure but proceeds with the run

## Creating a Custom Policy

1. **Create the JSON file** in `policies/`:

```json
{
  "policy_id": "policy.myteam.custom",
  "mode": "macp.mode.decision.v1",
  "schema_version": 1,
  "description": "Custom policy for my team's use case",
  "rules": {
    "voting": {
      "algorithm": "supermajority",
      "threshold": 0.75,
      "quorum": { "type": "count", "value": 3 }
    },
    "objection_handling": {
      "critical_severity_vetoes": true,
      "veto_threshold": 1
    },
    "evaluation": {
      "minimum_confidence": 0.6,
      "required_before_voting": true
    },
    "commitment": {
      "authority": "designated_roles",
      "require_vote_quorum": true,
      "designated_roles": ["risk", "compliance"]
    }
  }
}
```

2. **Reference it in a scenario template**:

```yaml
spec:
  overrides:
    launch:
      policyVersion: policy.myteam.custom
      policyHints:
        type: supermajority
        threshold: 0.75
        vetoEnabled: true
        vetoThreshold: 1
        minimumConfidence: 0.6
        designatedRoles: ["risk", "compliance"]
```

3. **Restart the service** — `PolicyLoaderService` will discover the new file on next load.

## Validation Rules

`PolicyLoaderService` validates policies on load and reports warnings for:

- Missing `policy_id`
- `schema_version` less than 1
- `supermajority` algorithm with `threshold <= 0.5`
- `weighted` algorithm without a `weights` map
- `veto_threshold` less than 1
- `minimum_confidence` outside the `0.0`-`1.0` range
- `designated_roles` authority without any roles defined

Validation warnings are non-blocking — the policy still loads but warnings are logged.
