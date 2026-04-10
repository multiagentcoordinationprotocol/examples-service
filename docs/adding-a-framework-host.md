# Adding a Framework Host

This guide explains how to add support for a new agent framework (e.g., AutoGen, Semantic Kernel, OpenAI Agents SDK).

## Step 1: Create a Host Adapter

Create `src/hosting/adapters/<framework>-host-adapter.ts`:

```typescript
import { AgentHostAdapter, PrepareLaunchInput, PreparedLaunch } from '../contracts/host-adapter.types';
import { AgentFramework, AgentManifest, ManifestValidationResult } from '../contracts/manifest.types';

export class MyFrameworkHostAdapter implements AgentHostAdapter {
  readonly framework: AgentFramework = 'myframework';  // add to AgentFramework union first

  validateManifest(manifest: AgentManifest): ManifestValidationResult {
    const errors: string[] = [];
    // Validate framework-specific requirements
    if (!manifest.frameworkConfig?.myRequiredField) {
      errors.push('frameworkConfig.myRequiredField is required');
    }
    return { valid: errors.length === 0, errors };
  }

  prepareLaunch(input: PrepareLaunchInput): PreparedLaunch {
    const { manifest, bootstrap } = input;
    return {
      command: manifest.host?.python ?? 'python3',
      args: [manifest.entrypoint.value],
      env: {
        ...process.env as Record<string, string>,
        MACP_BOOTSTRAP_FILE: '',
        MACP_CONTROL_PLANE_URL: bootstrap.runtime.baseUrl,
        MACP_FRAMEWORK: 'myframework',
        MACP_PARTICIPANT_ID: bootstrap.participant.participantId,
        MACP_RUN_ID: bootstrap.run.runId,
      },
      cwd: manifest.host?.cwd ?? process.cwd(),
      startupTimeoutMs: manifest.host?.startupTimeoutMs ?? 30000,
    };
  }
}
```

## Step 2: Update the Framework Type

Add your framework to the union in `src/hosting/contracts/manifest.types.ts`:

```typescript
export type AgentFramework = 'langgraph' | 'langchain' | 'crewai' | 'custom' | 'myframework';
```

## Step 3: Register the Adapter

In `src/hosting/host-adapter-registry.ts`, add:

```typescript
import { MyFrameworkHostAdapter } from './adapters/myframework-host-adapter';

// In constructor:
this.register(new MyFrameworkHostAdapter());
```

## Step 4: Create a Worker Package

Create `agents/myframework_worker/` with:

- `__init__.py`
- `main.py` — entry point that uses the SDK
- `<framework_specific>.py` — framework setup (graph, chain, crew, etc.)
- `mappers.py` — input/output mappers

Example `main.py` using the Participant SDK abstraction:

```python
#!/usr/bin/env python3
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'sdk', 'python'))

from macp_worker_sdk.bootstrap import log_agent
from macp_worker_sdk.participant import from_bootstrap

from my_framework import build_model
from mappers import map_kickoff_to_inputs

def main() -> int:
    participant = from_bootstrap()
    model = build_model()

    @participant.on('Proposal')
    def handle_proposal(ctx):
        inputs = map_kickoff_to_inputs(ctx.bootstrap.session_context)
        output = model.invoke(inputs)

        ctx.actions.evaluate(
            proposal_id=ctx.proposal_id,
            recommendation=output.get('recommendation', 'REVIEW'),
            confidence=output.get('confidence', 0.5),
            reason=output.get('reason', 'model evaluation'),
        )
        log_agent('evaluation sent', proposalId=ctx.proposal_id)
        participant.stop()

    participant.run()
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
```

The `Participant` abstraction handles the event poll loop, terminal detection, and deadline enforcement. The handler receives a `MessageContext` with `ctx.actions` for sending messages and `ctx.bootstrap` for accessing run context.

## Step 5: Create a Manifest (Optional)

Create `agents/manifests/my-agent.json`. Manifests are loaded via `loadManifest()` and are optional — agents work without a manifest file but fall back to legacy launch mode.



```json
{
  "id": "my-agent",
  "name": "My Agent",
  "framework": "myframework",
  "entrypoint": {
    "type": "python_file",
    "value": "agents/myframework_worker/main.py"
  },
  "frameworkConfig": {
    "myRequiredField": "value"
  }
}
```

## Step 6: Register in the Agent Catalog

Add an entry to `EXAMPLE_AGENT_DEFINITIONS` in `src/example-agents/example-agent-catalog.service.ts`.

## Step 7: Add Tests

- Unit test for the adapter in `src/hosting/adapters/adapters.spec.ts`
- Add the agent to an existing scenario or create a new one
- Run `npm test`, `npm run test:e2e`, and `npm run test:integration`

## Key Rules

1. **Never let framework code leak into controllers or compiler** — all framework logic stays in adapters and worker packages
2. **All outbound messages must use the MACP envelope format** — use `MacpMessageBuilder`
3. **Workers must poll the control plane** — no custom backchannels
4. **Validate manifests before spawn** — bad config should fail fast with clear errors
5. **Framework workers must gracefully fall back** when framework libraries aren't installed
