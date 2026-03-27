# Scenario Authoring Guide

## Directory Structure

Each scenario pack follows this layout:

```
packs/{pack-slug}/
  pack.yaml
  scenarios/{scenario-slug}/{version}/
    scenario.yaml
    templates/
      default.yaml
      *.yaml
```

## Pack File

`pack.yaml` defines the pack metadata:

```yaml
apiVersion: scenarios.macp.dev/v1
kind: ScenarioPack
metadata:
  slug: fraud                              # URL-safe identifier
  name: Fraud                              # Display name
  description: Fraud and risk decisioning demos
  tags: [fraud, risk, demo]
```

## Scenario Version File

`scenario.yaml` defines a single versioned scenario:

```yaml
apiVersion: scenarios.macp.dev/v1
kind: ScenarioVersion
metadata:
  pack: fraud
  scenario: high-value-new-device
  version: 1.0.0
  name: High Value Purchase From New Device
  summary: Description shown in the catalog
  tags: [fraud, demo]

spec:
  runtime:
    kind: rust
    version: v1

  inputs:
    schema:                                # Standard JSON Schema
      type: object
      properties:
        transactionAmount:
          type: number
          default: 2400
          minimum: 1
      required: [transactionAmount]

  launch:
    modeName: macp.mode.decision.v1
    modeVersion: 1.0.0
    configurationVersion: config.default
    policyVersion: policy.default          # optional
    ttlMs: 300000
    initiatorParticipantId: risk-agent     # optional

    participants:
      - id: fraud-agent
        role: fraud
        agentRef: fraud-agent              # matches example-agent catalog

    contextTemplate:                       # {{ inputs.* }} substitution
      transactionAmount: "{{ inputs.transactionAmount }}"

    metadataTemplate:
      demoType: fraud-decision

    kickoffTemplate:
      - from: risk-agent
        to: [fraud-agent]
        kind: proposal
        messageType: Proposal
        payloadEnvelope:
          encoding: proto
          proto:
            typeName: macp.modes.decision.v1.ProposalPayload
            value:
              proposal_id: "{{ inputs.customerId }}-review"

  execution:
    tags: [demo, fraud]
    requester:
      actorId: example-service
      actorType: service

  outputs:
    expectedDecisionKinds: [approve, step_up, decline]
    expectedSignals: [suspicious_device]
```

## Template File

Templates provide default overrides and launch configuration variants:

```yaml
apiVersion: scenarios.macp.dev/v1
kind: ScenarioTemplate
metadata:
  scenarioVersion: fraud/high-value-new-device@1.0.0
  slug: strict-risk
  name: Strict Risk

spec:
  defaults:                                # Override scenario schema defaults
    deviceTrustScore: 0.08
    priorChargebacks: 2

  overrides:
    launch:                                # Deep-merged with scenario launch config
      ttlMs: 180000
      metadataTemplate:
        posture: strict-risk
    runtime:                               # Override runtime selection
      kind: rust
      version: v2
    execution:                             # Override execution config
      tags: [strict, fraud]
```

## Template Substitution

Use `{{ path.to.value }}` placeholders in `contextTemplate`, `metadataTemplate`, and `kickoffTemplate`. During compilation:

- **Exact match** (`"{{ inputs.amount }}"`) — preserves the original type (number, boolean, etc.)
- **Embedded** (`"Amount: {{ inputs.amount }}"`) — coerces to string
- **Nested paths** are supported: `{{ inputs.nested.field }}`
- **Undefined placeholders** throw a `COMPILATION_ERROR`

## Default Merge Precedence

```
JSON Schema defaults < Template defaults < User-provided inputs
```

## Adding a New Scenario

1. Create the pack directory: `packs/{slug}/pack.yaml`
2. Create the scenario directory: `packs/{slug}/scenarios/{scenario-slug}/{version}/`
3. Write `scenario.yaml` with the schema above
4. Add at least a `default.yaml` template in `templates/`
5. Ensure `agentRef` values in participants match entries in the example agent catalog
6. The service auto-discovers new packs on the next request (when `REGISTRY_CACHE_TTL_MS=0`)
