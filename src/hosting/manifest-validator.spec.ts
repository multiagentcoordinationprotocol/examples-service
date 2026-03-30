import { ManifestValidator } from './manifest-validator';
import { HostAdapterRegistry } from './host-adapter-registry';
import { AgentManifest } from './contracts/manifest.types';

describe('ManifestValidator', () => {
  let validator: ManifestValidator;

  beforeEach(() => {
    validator = new ManifestValidator(new HostAdapterRegistry());
  });

  function buildManifest(overrides?: Partial<AgentManifest>): AgentManifest {
    return {
      id: 'test-agent',
      name: 'Test Agent',
      framework: 'langgraph',
      entrypoint: {
        type: 'python_file',
        value: 'agents/test.py'
      },
      frameworkConfig: {
        graphFactory: 'build_graph',
        inputMapper: 'map_input',
        outputMapper: 'map_output'
      },
      ...overrides
    };
  }

  it('should validate a valid langgraph manifest', () => {
    const result = validator.validate(buildManifest());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should validate a valid langchain manifest', () => {
    const result = validator.validate(buildManifest({
      framework: 'langchain',
      entrypoint: { type: 'python_file', value: 'agents/chain.py' },
      frameworkConfig: {
        factory: 'build_agent',
        inputMapper: 'map_input',
        outputMapper: 'map_output'
      }
    }));
    expect(result.valid).toBe(true);
  });

  it('should validate a valid crewai manifest', () => {
    const result = validator.validate(buildManifest({
      framework: 'crewai',
      entrypoint: { type: 'python_file', value: 'agents/crew.py' },
      frameworkConfig: {
        crewFactory: 'build_crew',
        inputMapper: 'map_input',
        outputMapper: 'map_output'
      }
    }));
    expect(result.valid).toBe(true);
  });

  it('should validate a valid custom manifest', () => {
    const result = validator.validate(buildManifest({
      framework: 'custom',
      entrypoint: { type: 'node_file', value: 'agents/worker.js' },
      frameworkConfig: undefined
    }));
    expect(result.valid).toBe(true);
  });

  it('should fail when id is missing', () => {
    const result = validator.validate(buildManifest({ id: '' }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('manifest.id is required');
  });

  it('should fail when name is missing', () => {
    const result = validator.validate(buildManifest({ name: '' }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('manifest.name is required');
  });

  it('should fail when entrypoint is missing', () => {
    const result = validator.validate({
      ...buildManifest(),
      entrypoint: undefined as unknown as AgentManifest['entrypoint']
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('manifest.entrypoint is required');
  });

  it('should fail for unsupported framework', () => {
    const result = validator.validate(buildManifest({
      framework: 'autogen' as never
    }));
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('unsupported framework');
  });

  it('should fail langgraph manifest with wrong entrypoint type', () => {
    const result = validator.validate(buildManifest({
      entrypoint: { type: 'node_file', value: 'agents/test.js' }
    }));
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('python_module or python_file');
  });

  it('should fail langchain manifest when factory is missing', () => {
    const result = validator.validate(buildManifest({
      framework: 'langchain',
      frameworkConfig: {
        inputMapper: 'map_input',
        outputMapper: 'map_output'
      }
    }));
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('factory')
    ]));
  });

  it('should fail crewai manifest when crewFactory is missing', () => {
    const result = validator.validate(buildManifest({
      framework: 'crewai',
      frameworkConfig: {
        inputMapper: 'map_input',
        outputMapper: 'map_output'
      }
    }));
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('crewFactory')
    ]));
  });
});
