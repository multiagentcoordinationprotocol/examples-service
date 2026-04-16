import { AppConfigService, readBoolean, readNumber, readStringList, readStringMap } from './app-config.service';
import { AppException } from '../errors/app-exception';
import { ErrorCode } from '../errors/error-codes';

describe('readBoolean', () => {
  const original = process.env;

  beforeEach(() => {
    process.env = { ...original };
  });

  afterAll(() => {
    process.env = original;
  });

  it('should return default when env var is not set', () => {
    delete process.env.TEST_BOOL;
    expect(readBoolean('TEST_BOOL', true)).toBe(true);
    expect(readBoolean('TEST_BOOL', false)).toBe(false);
  });

  it('should parse truthy values', () => {
    for (const val of ['1', 'true', 'yes', 'on', 'TRUE', 'Yes']) {
      process.env.TEST_BOOL = val;
      expect(readBoolean('TEST_BOOL')).toBe(true);
    }
  });

  it('should parse falsy values', () => {
    for (const val of ['0', 'false', 'no', 'off', 'anything']) {
      process.env.TEST_BOOL = val;
      expect(readBoolean('TEST_BOOL')).toBe(false);
    }
  });
});

describe('readNumber', () => {
  const original = process.env;

  beforeEach(() => {
    process.env = { ...original };
  });

  afterAll(() => {
    process.env = original;
  });

  it('should return default when env var is not set', () => {
    delete process.env.TEST_NUM;
    expect(readNumber('TEST_NUM', 42)).toBe(42);
  });

  it('should parse valid numbers', () => {
    process.env.TEST_NUM = '3000';
    expect(readNumber('TEST_NUM', 0)).toBe(3000);
  });

  it('should return default for non-numeric values', () => {
    process.env.TEST_NUM = 'abc';
    expect(readNumber('TEST_NUM', 99)).toBe(99);
  });
});

describe('readStringList', () => {
  const original = process.env;

  beforeEach(() => {
    process.env = { ...original };
  });

  afterAll(() => {
    process.env = original;
  });

  it('should return empty array when env var is not set', () => {
    delete process.env.TEST_LIST;
    expect(readStringList('TEST_LIST')).toEqual([]);
  });

  it('should return empty array for empty string', () => {
    process.env.TEST_LIST = '';
    expect(readStringList('TEST_LIST')).toEqual([]);
  });

  it('should split comma-separated values and trim whitespace', () => {
    process.env.TEST_LIST = 'key1, key2 , key3';
    expect(readStringList('TEST_LIST')).toEqual(['key1', 'key2', 'key3']);
  });
});

describe('readStringMap', () => {
  const original = process.env;

  beforeEach(() => {
    process.env = { ...original };
  });

  afterAll(() => {
    process.env = original;
  });

  it('returns empty map when env var is not set', () => {
    delete process.env.TEST_MAP;
    expect(readStringMap('TEST_MAP')).toEqual({});
  });

  it('returns empty map for empty string', () => {
    process.env.TEST_MAP = '';
    expect(readStringMap('TEST_MAP')).toEqual({});
  });

  it('parses a JSON object of string→string', () => {
    process.env.TEST_MAP = '{"risk-agent":"tok-risk","fraud-agent":"tok-fraud"}';
    expect(readStringMap('TEST_MAP')).toEqual({
      'risk-agent': 'tok-risk',
      'fraud-agent': 'tok-fraud'
    });
  });

  it('throws AppException(INVALID_CONFIG) on invalid JSON', () => {
    process.env.TEST_MAP = 'not-json';
    try {
      readStringMap('TEST_MAP');
      fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AppException);
      expect((err as AppException).errorCode).toBe(ErrorCode.INVALID_CONFIG);
      expect((err as AppException).message).toMatch(/must be valid JSON/);
    }
  });

  it('throws AppException(INVALID_CONFIG) when JSON is an array', () => {
    process.env.TEST_MAP = '["a","b"]';
    try {
      readStringMap('TEST_MAP');
      fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AppException);
      expect((err as AppException).errorCode).toBe(ErrorCode.INVALID_CONFIG);
      expect((err as AppException).message).toMatch(/must be a JSON object/);
    }
  });

  it('throws AppException(INVALID_CONFIG) when value is not a non-empty string', () => {
    process.env.TEST_MAP = '{"risk-agent":""}';
    try {
      readStringMap('TEST_MAP');
      fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AppException);
      expect((err as AppException).errorCode).toBe(ErrorCode.INVALID_CONFIG);
      expect((err as AppException).message).toMatch(/must be a non-empty string/);
    }
  });

  it('drops empty keys but keeps valid entries', () => {
    process.env.TEST_MAP = '{"":"nope","risk":"tok"}';
    expect(readStringMap('TEST_MAP')).toEqual({ risk: 'tok' });
  });
});

describe('AppConfigService', () => {
  const original = process.env;

  beforeEach(() => {
    process.env = { ...original };
  });

  afterAll(() => {
    process.env = original;
  });

  it('should use default values', () => {
    delete process.env.PORT;
    delete process.env.HOST;
    delete process.env.PACKS_DIR;
    delete process.env.REGISTRY_CACHE_TTL_MS;
    delete process.env.EXAMPLES_SERVICE_AGENT_TOKENS_JSON;
    delete process.env.MACP_RUNTIME_ADDRESS;
    delete process.env.MACP_RUNTIME_TLS;
    delete process.env.MACP_RUNTIME_ALLOW_INSECURE;
    const config = new AppConfigService();
    expect(config.port).toBe(3000);
    expect(config.host).toBe('0.0.0.0');
    expect(config.packsDir).toBe('./packs');
    expect(config.registryCacheTtlMs).toBe(0);
    expect(config.agentRuntimeTokens).toEqual({});
    expect(config.runtimeAddress).toBe('');
    expect(config.runtimeTls).toBe(true);
    expect(config.runtimeAllowInsecure).toBe(false);
  });

  it('should read from environment variables', () => {
    process.env.PORT = '4000';
    process.env.PACKS_DIR = '/custom/packs';
    process.env.REGISTRY_CACHE_TTL_MS = '60000';
    const config = new AppConfigService();
    expect(config.port).toBe(4000);
    expect(config.packsDir).toBe('/custom/packs');
    expect(config.registryCacheTtlMs).toBe(60000);
  });

  it('loads agentRuntimeTokens from EXAMPLES_SERVICE_AGENT_TOKENS_JSON', () => {
    process.env.EXAMPLES_SERVICE_AGENT_TOKENS_JSON =
      '{"risk-agent":"tok-risk","fraud-agent":"tok-fraud","growth-agent":"tok-growth","compliance-agent":"tok-comp"}';
    const config = new AppConfigService();
    expect(Object.keys(config.agentRuntimeTokens).sort()).toEqual([
      'compliance-agent',
      'fraud-agent',
      'growth-agent',
      'risk-agent'
    ]);
    expect(config.resolveAgentToken('risk-agent')).toBe('tok-risk');
    expect(config.resolveAgentToken('nobody')).toBeUndefined();
    expect(config.resolveAgentToken(undefined)).toBeUndefined();
  });

  it('honors MACP_RUNTIME_ADDRESS/TLS/ALLOW_INSECURE', () => {
    process.env.MACP_RUNTIME_ADDRESS = 'runtime.local:50051';
    process.env.MACP_RUNTIME_TLS = 'false';
    process.env.MACP_RUNTIME_ALLOW_INSECURE = 'true';
    const config = new AppConfigService();
    expect(config.runtimeAddress).toBe('runtime.local:50051');
    expect(config.runtimeTls).toBe(false);
    expect(config.runtimeAllowInsecure).toBe(true);
  });
});
