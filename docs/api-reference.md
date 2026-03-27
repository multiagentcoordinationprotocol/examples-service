# API Reference

All endpoints return JSON. Error responses follow the format:

```json
{
  "statusCode": 400,
  "errorCode": "VALIDATION_ERROR",
  "message": "Input validation failed",
  "metadata": { ... }
}
```

## Health

### `GET /healthz`

Liveness probe.

**Response:** `200`
```json
{ "ok": true, "service": "scenario-registry" }
```

## Catalog

### `GET /packs`

List all available scenario packs.

**Response:** `200`
```json
[
  {
    "slug": "fraud",
    "name": "Fraud",
    "description": "Fraud and risk decisioning demos",
    "tags": ["fraud", "risk", "growth", "demo"]
  }
]
```

### `GET /packs/:packSlug/scenarios`

List scenarios in a pack with versions, templates, and agent refs.

**Response:** `200`
```json
[
  {
    "scenario": "high-value-new-device",
    "name": "High Value Purchase From New Device",
    "summary": "Fraud Agent, Growth Agent, and Risk Agent discuss a transaction and produce a decision.",
    "versions": ["1.0.0"],
    "templates": ["default", "strict-risk"],
    "tags": ["fraud", "growth", "risk", "demo"],
    "runtimeKind": "rust",
    "agentRefs": ["fraud-agent", "growth-agent", "risk-agent"]
  }
]
```

**Errors:** `404 PACK_NOT_FOUND`

## Launch

### `GET /packs/:packSlug/scenarios/:scenarioSlug/versions/:version/launch-schema`

Get the launch form schema, defaults, agent previews, and runtime hints.

**Query params:**
- `template` (optional) — template slug to apply

**Response:** `200`
```json
{
  "scenarioRef": "fraud/high-value-new-device@1.0.0",
  "templateId": "default",
  "formSchema": { "type": "object", "properties": { ... } },
  "defaults": { "transactionAmount": 2400, "deviceTrustScore": 0.18 },
  "participants": [
    { "id": "fraud-agent", "role": "fraud", "agentRef": "fraud-agent" }
  ],
  "agents": [
    {
      "agentRef": "fraud-agent",
      "name": "Fraud Agent",
      "role": "fraud",
      "framework": "langgraph",
      "transportIdentity": "agent://fraud-agent",
      "entrypoint": "examples/fraud/langgraph_fraud_agent.py:create_graph",
      "bootstrapStrategy": "manifest-only",
      "bootstrapMode": "deferred"
    }
  ],
  "runtime": { "kind": "rust", "version": "v1" },
  "launchSummary": {
    "modeName": "macp.mode.decision.v1",
    "modeVersion": "1.0.0",
    "configurationVersion": "config.default",
    "policyVersion": "policy.default",
    "ttlMs": 300000,
    "initiatorParticipantId": "risk-agent"
  },
  "expectedDecisionKinds": ["approve", "step_up", "decline"]
}
```

**Errors:** `404 SCENARIO_NOT_FOUND | VERSION_NOT_FOUND | TEMPLATE_NOT_FOUND`

### `POST /launch/compile`

Validate user inputs and compile them into a control-plane-ready ExecutionRequest.

**Request body:**
```json
{
  "scenarioRef": "fraud/high-value-new-device@1.0.0",
  "templateId": "default",
  "mode": "sandbox",
  "inputs": {
    "transactionAmount": 3200,
    "deviceTrustScore": 0.12,
    "accountAgeDays": 5,
    "isVipCustomer": true,
    "priorChargebacks": 1
  }
}
```

**Response:** `201`
```json
{
  "executionRequest": { ... },
  "display": {
    "title": "High Value Purchase From New Device",
    "scenarioRef": "fraud/high-value-new-device@1.0.0",
    "templateId": "default",
    "expectedDecisionKinds": ["approve", "step_up", "decline"]
  },
  "participantBindings": [
    { "participantId": "fraud-agent", "role": "fraud", "agentRef": "fraud-agent" }
  ]
}
```

**Errors:** `400 VALIDATION_ERROR | INVALID_SCENARIO_REF`, `404 SCENARIO_NOT_FOUND | VERSION_NOT_FOUND | TEMPLATE_NOT_FOUND`

## Examples

### `POST /examples/run`

Full showcase flow: compile scenario, bootstrap example agents, and optionally submit to the control plane.

**Request body:**
```json
{
  "scenarioRef": "fraud/high-value-new-device@1.0.0",
  "templateId": "strict-risk",
  "mode": "sandbox",
  "inputs": { "transactionAmount": 3200 },
  "bootstrapAgents": true,
  "submitToControlPlane": false
}
```

**Response:** `201`
```json
{
  "compiled": { "executionRequest": { ... }, "display": { ... }, "participantBindings": [ ... ] },
  "hostedAgents": [
    {
      "participantId": "fraud-agent",
      "agentRef": "fraud-agent",
      "name": "Fraud Agent",
      "role": "fraud",
      "framework": "langgraph",
      "transportIdentity": "agent://fraud-agent",
      "entrypoint": "examples/fraud/langgraph_fraud_agent.py:create_graph",
      "bootstrapStrategy": "manifest-only",
      "bootstrapMode": "deferred",
      "status": "bootstrapped"
    }
  ],
  "controlPlane": {
    "baseUrl": "http://localhost:3001",
    "validated": false,
    "submitted": false
  }
}
```

**Errors:** `400 VALIDATION_ERROR | AGENT_NOT_FOUND`, `502 CONTROL_PLANE_UNAVAILABLE`

## Swagger UI

Available at `GET /docs` when `NODE_ENV=development`.
