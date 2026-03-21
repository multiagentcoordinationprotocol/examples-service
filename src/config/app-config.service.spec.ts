import { AppConfigService, readBoolean, readNumber, readStringList } from './app-config.service';

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
    const config = new AppConfigService();
    expect(config.port).toBe(3000);
    expect(config.host).toBe('0.0.0.0');
    expect(config.packsDir).toBe('./packs');
    expect(config.registryCacheTtlMs).toBe(0);
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
});
