import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { LangGraphHostAdapter } from './langgraph-host-adapter';
import { LangChainHostAdapter } from './langchain-host-adapter';
import { CrewAIHostAdapter } from './crewai-host-adapter';
import { CustomHostAdapter } from './custom-host-adapter';
import { AgentManifest } from '../contracts/manifest.types';
import { BootstrapPayload } from '../contracts/bootstrap.types';

function buildBootstrap(): BootstrapPayload {
  return {
    participant_id: 'test-agent',
    session_id: 'sess-uuid-v4',
    mode: 'test',
    runtime_url: '',
    auth_token: 'jwt-test',
    participants: [],
    mode_version: '1.0.0',
    configuration_version: 'config.default',
    metadata: {
      run_id: 'run-1',
      scenario_ref: 'test/test@1.0.0',
      role: 'test',
      framework: 'langgraph',
      agent_ref: 'test-agent'
    }
  };
}

describe('LangGraphHostAdapter', () => {
  const adapter = new LangGraphHostAdapter();

  it('has framework = langgraph', () => {
    expect(adapter.framework).toBe('langgraph');
  });

  it('validates a correct manifest', () => {
    const manifest: AgentManifest = {
      id: 'fraud-agent',
      name: 'Fraud Agent',
      framework: 'langgraph',
      entrypoint: { type: 'python_file', value: 'agents/fraud.py' },
      frameworkConfig: { graphFactory: 'build_graph', inputMapper: 'map_in', outputMapper: 'map_out' }
    };
    const result = adapter.validateManifest(manifest);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects non-python entrypoint types', () => {
    const manifest: AgentManifest = {
      id: 'fraud-agent',
      name: 'Fraud Agent',
      framework: 'langgraph',
      entrypoint: { type: 'node_file', value: 'agents/fraud.js' },
      frameworkConfig: { graphFactory: 'build_graph', inputMapper: 'map_in', outputMapper: 'map_out' }
    };
    const result = adapter.validateManifest(manifest);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('python_module or python_file');
  });

  it('rejects missing graphFactory', () => {
    const manifest: AgentManifest = {
      id: 'fraud-agent',
      name: 'Fraud Agent',
      framework: 'langgraph',
      entrypoint: { type: 'python_file', value: 'agents/fraud.py' },
      frameworkConfig: { inputMapper: 'map_in', outputMapper: 'map_out' }
    };
    const result = adapter.validateManifest(manifest);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([expect.stringContaining('graphFactory')]));
  });

  it('prepares launch with python command and module args', () => {
    const manifest: AgentManifest = {
      id: 'fraud-agent',
      name: 'Fraud Agent',
      framework: 'langgraph',
      entrypoint: { type: 'python_module', value: 'agents.fraud.main' }
    };
    const prepared = adapter.prepareLaunch({ manifest, bootstrap: buildBootstrap() });
    expect(prepared.command).toBe('python3');
    expect(prepared.args).toEqual(['-m', 'agents.fraud.main']);
    expect(prepared.env.MACP_FRAMEWORK).toBe('langgraph');
    expect(prepared.env.PYTHONUNBUFFERED).toBe('1');
  });

  it('prepares launch with python_file args', () => {
    const manifest: AgentManifest = {
      id: 'fraud-agent',
      name: 'Fraud Agent',
      framework: 'langgraph',
      entrypoint: { type: 'python_file', value: 'agents/fraud.py' }
    };
    const prepared = adapter.prepareLaunch({ manifest, bootstrap: buildBootstrap() });
    expect(prepared.args).toEqual(['agents/fraud.py']);
  });
});

describe('LangChainHostAdapter', () => {
  const adapter = new LangChainHostAdapter();

  it('has framework = langchain', () => {
    expect(adapter.framework).toBe('langchain');
  });

  it('validates a correct manifest', () => {
    const manifest: AgentManifest = {
      id: 'growth-agent',
      name: 'Growth Agent',
      framework: 'langchain',
      entrypoint: { type: 'python_file', value: 'agents/growth.py' },
      frameworkConfig: { factory: 'build_agent', inputMapper: 'map_in', outputMapper: 'map_out' }
    };
    expect(adapter.validateManifest(manifest).valid).toBe(true);
  });

  it('rejects missing factory', () => {
    const manifest: AgentManifest = {
      id: 'growth-agent',
      name: 'Growth Agent',
      framework: 'langchain',
      entrypoint: { type: 'python_file', value: 'agents/growth.py' },
      frameworkConfig: { inputMapper: 'map_in', outputMapper: 'map_out' }
    };
    const result = adapter.validateManifest(manifest);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([expect.stringContaining('factory')]));
  });

  it('rejects invalid invokeMode', () => {
    const manifest: AgentManifest = {
      id: 'growth-agent',
      name: 'Growth Agent',
      framework: 'langchain',
      entrypoint: { type: 'python_file', value: 'agents/growth.py' },
      frameworkConfig: { factory: 'build_agent', invokeMode: 'invalid', inputMapper: 'map_in', outputMapper: 'map_out' }
    };
    const result = adapter.validateManifest(manifest);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([expect.stringContaining('invokeMode')]));
  });
});

describe('CrewAIHostAdapter', () => {
  const adapter = new CrewAIHostAdapter();

  it('has framework = crewai', () => {
    expect(adapter.framework).toBe('crewai');
  });

  it('validates a correct manifest', () => {
    const manifest: AgentManifest = {
      id: 'compliance-agent',
      name: 'Compliance Agent',
      framework: 'crewai',
      entrypoint: { type: 'python_file', value: 'agents/compliance.py' },
      frameworkConfig: { crewFactory: 'build_crew', inputMapper: 'map_in', outputMapper: 'map_out' }
    };
    expect(adapter.validateManifest(manifest).valid).toBe(true);
  });

  it('rejects missing crewFactory', () => {
    const manifest: AgentManifest = {
      id: 'compliance-agent',
      name: 'Compliance Agent',
      framework: 'crewai',
      entrypoint: { type: 'python_file', value: 'agents/compliance.py' },
      frameworkConfig: { inputMapper: 'map_in', outputMapper: 'map_out' }
    };
    const result = adapter.validateManifest(manifest);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([expect.stringContaining('crewFactory')]));
  });

  it('uses a longer default startup timeout', () => {
    const manifest: AgentManifest = {
      id: 'compliance-agent',
      name: 'Compliance Agent',
      framework: 'crewai',
      entrypoint: { type: 'python_file', value: 'agents/compliance.py' }
    };
    const prepared = adapter.prepareLaunch({ manifest, bootstrap: buildBootstrap() });
    expect(prepared.startupTimeoutMs).toBe(45000);
  });
});

describe('CustomHostAdapter', () => {
  const adapter = new CustomHostAdapter();

  it('has framework = custom', () => {
    expect(adapter.framework).toBe('custom');
  });

  it('validates a correct manifest with node_file', () => {
    const manifest: AgentManifest = {
      id: 'risk-agent',
      name: 'Risk Agent',
      framework: 'custom',
      entrypoint: { type: 'node_file', value: 'agents/risk.js' }
    };
    expect(adapter.validateManifest(manifest).valid).toBe(true);
  });

  it('validates a correct manifest with python_file', () => {
    const manifest: AgentManifest = {
      id: 'risk-agent',
      name: 'Risk Agent',
      framework: 'custom',
      entrypoint: { type: 'python_file', value: 'agents/risk.py' }
    };
    expect(adapter.validateManifest(manifest).valid).toBe(true);
  });

  it('uses node for node_file entrypoint', () => {
    const manifest: AgentManifest = {
      id: 'risk-agent',
      name: 'Risk Agent',
      framework: 'custom',
      entrypoint: { type: 'node_file', value: 'agents/risk.js' }
    };
    const prepared = adapter.prepareLaunch({ manifest, bootstrap: buildBootstrap() });
    expect(prepared.command).toBe(process.execPath);
    expect(prepared.args).toEqual(['agents/risk.js']);
  });

  it('uses python for python_file entrypoint', () => {
    const manifest: AgentManifest = {
      id: 'risk-agent',
      name: 'Risk Agent',
      framework: 'custom',
      entrypoint: { type: 'python_file', value: 'agents/risk.py' }
    };
    const prepared = adapter.prepareLaunch({ manifest, bootstrap: buildBootstrap() });
    expect(prepared.command).toBe('python3');
    expect(prepared.env.PYTHONUNBUFFERED).toBe('1');
  });

  describe('node_file entrypoint src/*.ts → dist/*.js resolution', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'custom-host-adapter-'));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('rewrites src/*.ts to dist/*.js when compiled file exists (Docker scenario)', () => {
      // Simulate the Docker layout: only dist/ is present on disk.
      const distDir = path.join(tmpDir, 'dist', 'example-agents', 'runtime');
      fs.mkdirSync(distDir, { recursive: true });
      fs.writeFileSync(path.join(distDir, 'risk-decider.worker.js'), '// compiled');

      const manifest: AgentManifest = {
        id: 'risk-agent',
        name: 'Risk Agent',
        framework: 'custom',
        entrypoint: { type: 'node_file', value: 'src/example-agents/runtime/risk-decider.worker.ts' },
        host: { cwd: tmpDir }
      };
      const prepared = adapter.prepareLaunch({ manifest, bootstrap: buildBootstrap() });
      expect(prepared.args[0]).toBe('dist/example-agents/runtime/risk-decider.worker.js');
    });

    it('prefers dist/*.js over src/*.ts when BOTH exist (Node cannot run TS directly)', () => {
      // Simulate the local dev post-build layout: src/ AND dist/ both exist.
      // Without this preference, Node would try to execute the .ts source and crash.
      const srcDir = path.join(tmpDir, 'src', 'example-agents', 'runtime');
      const distDir = path.join(tmpDir, 'dist', 'example-agents', 'runtime');
      fs.mkdirSync(srcDir, { recursive: true });
      fs.mkdirSync(distDir, { recursive: true });
      fs.writeFileSync(path.join(srcDir, 'risk-decider.worker.ts'), '// source');
      fs.writeFileSync(path.join(distDir, 'risk-decider.worker.js'), '// compiled');

      const manifest: AgentManifest = {
        id: 'risk-agent',
        name: 'Risk Agent',
        framework: 'custom',
        entrypoint: { type: 'node_file', value: 'src/example-agents/runtime/risk-decider.worker.ts' },
        host: { cwd: tmpDir }
      };
      const prepared = adapter.prepareLaunch({ manifest, bootstrap: buildBootstrap() });
      expect(prepared.args[0]).toBe('dist/example-agents/runtime/risk-decider.worker.js');
    });

    it('falls back to raw value when neither dist/*.js nor the file exists', () => {
      const manifest: AgentManifest = {
        id: 'risk-agent',
        name: 'Risk Agent',
        framework: 'custom',
        entrypoint: { type: 'node_file', value: 'src/missing/module.ts' },
        host: { cwd: tmpDir }
      };
      // No files exist — adapter returns the logical value untouched; the
      // launch supervisor is responsible for reporting the failure.
      const prepared = adapter.prepareLaunch({ manifest, bootstrap: buildBootstrap() });
      expect(prepared.args[0]).toBe('src/missing/module.ts');
    });

    it('leaves a raw absolute-ish js path untouched when it exists', () => {
      const jsDir = path.join(tmpDir, 'agents');
      fs.mkdirSync(jsDir, { recursive: true });
      fs.writeFileSync(path.join(jsDir, 'risk.js'), '// plain');

      const manifest: AgentManifest = {
        id: 'risk-agent',
        name: 'Risk Agent',
        framework: 'custom',
        entrypoint: { type: 'node_file', value: 'agents/risk.js' },
        host: { cwd: tmpDir }
      };
      const prepared = adapter.prepareLaunch({ manifest, bootstrap: buildBootstrap() });
      expect(prepared.args[0]).toBe('agents/risk.js');
    });
  });
});
