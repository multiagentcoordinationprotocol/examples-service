import { HostAdapterRegistry } from './host-adapter-registry';

describe('HostAdapterRegistry', () => {
  let registry: HostAdapterRegistry;

  beforeEach(() => {
    registry = new HostAdapterRegistry();
  });

  it('should register all four built-in adapters', () => {
    const frameworks = registry.list();
    expect(frameworks).toContain('langgraph');
    expect(frameworks).toContain('langchain');
    expect(frameworks).toContain('crewai');
    expect(frameworks).toContain('custom');
    expect(frameworks).toHaveLength(4);
  });

  it('should return an adapter for a known framework', () => {
    const adapter = registry.get('langgraph');
    expect(adapter).toBeDefined();
    expect(adapter?.framework).toBe('langgraph');
  });

  it('should return undefined for an unknown framework', () => {
    const adapter = registry.get('unknown' as never);
    expect(adapter).toBeUndefined();
  });

  it('should throw for an unknown framework with getOrThrow', () => {
    expect(() => registry.getOrThrow('unknown' as never)).toThrow(/no host adapter registered/);
  });

  it('should correctly report has()', () => {
    expect(registry.has('langgraph')).toBe(true);
    expect(registry.has('unknown' as never)).toBe(false);
  });

  it('should allow registering a custom adapter', () => {
    const customAdapter = {
      framework: 'custom' as const,
      validateManifest: jest.fn().mockReturnValue({ valid: true, errors: [] }),
      prepareLaunch: jest.fn()
    };

    registry.register(customAdapter);
    expect(registry.get('custom')).toBe(customAdapter);
  });
});
