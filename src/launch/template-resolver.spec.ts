import { parseScenarioRef, extractSchemaDefaults, deepMerge, substitute } from './template-resolver';
import { AppException } from '../errors/app-exception';
import { ErrorCode } from '../errors/error-codes';

describe('parseScenarioRef', () => {
  it('should parse a valid scenarioRef', () => {
    const result = parseScenarioRef('fraud/high-value-new-device@1.0.0');
    expect(result).toEqual({
      packSlug: 'fraud',
      scenarioSlug: 'high-value-new-device',
      version: '1.0.0'
    });
  });

  it('should throw for missing @', () => {
    expect(() => parseScenarioRef('fraud/scenario')).toThrow(AppException);
    try {
      parseScenarioRef('fraud/scenario');
    } catch (err) {
      expect((err as AppException).errorCode).toBe(ErrorCode.INVALID_SCENARIO_REF);
    }
  });

  it('should throw for missing /', () => {
    expect(() => parseScenarioRef('fraud@1.0.0')).toThrow(AppException);
  });

  it('should throw for empty string', () => {
    expect(() => parseScenarioRef('')).toThrow(AppException);
  });

  it('should throw for empty components', () => {
    expect(() => parseScenarioRef('/scenario@1.0.0')).toThrow(AppException);
    expect(() => parseScenarioRef('pack/@1.0.0')).toThrow(AppException);
    expect(() => parseScenarioRef('pack/scenario@')).toThrow(AppException);
  });
});

describe('extractSchemaDefaults', () => {
  it('should extract defaults from schema properties', () => {
    const schema = {
      type: 'object',
      properties: {
        amount: { type: 'number', default: 100 },
        name: { type: 'string', default: 'test' },
        noDefault: { type: 'string' }
      }
    };
    const result = extractSchemaDefaults(schema);
    expect(result).toEqual({ amount: 100, name: 'test' });
  });

  it('should return empty object for schema without properties', () => {
    expect(extractSchemaDefaults({})).toEqual({});
    expect(extractSchemaDefaults({ type: 'object' })).toEqual({});
  });

  it('should handle boolean defaults', () => {
    const schema = {
      properties: {
        flag: { type: 'boolean', default: false }
      }
    };
    expect(extractSchemaDefaults(schema)).toEqual({ flag: false });
  });
});

describe('deepMerge', () => {
  it('should merge flat objects', () => {
    const base = { a: 1, b: 2 };
    const override = { b: 3, c: 4 };
    expect(deepMerge(base, override)).toEqual({ a: 1, b: 3, c: 4 });
  });

  it('should recursively merge nested objects', () => {
    const base = { nested: { a: 1, b: 2 } } as Record<string, unknown>;
    const override = { nested: { b: 3 } };
    expect(deepMerge(base, override)).toEqual({ nested: { a: 1, b: 3 } });
  });

  it('should replace arrays (not concatenate)', () => {
    const base = { arr: [1, 2, 3] };
    const override = { arr: [4, 5] };
    expect(deepMerge(base, override)).toEqual({ arr: [4, 5] });
  });

  it('should not modify the original objects', () => {
    const base = { a: 1, nested: { b: 2 } } as Record<string, unknown>;
    const override = { nested: { c: 3 } };
    deepMerge(base, override);
    expect(base).toEqual({ a: 1, nested: { b: 2 } });
  });

  it('should skip undefined override values', () => {
    const base = { a: 1, b: 2 };
    const override = { a: undefined };
    expect(deepMerge(base, override)).toEqual({ a: 1, b: 2 });
  });

  it('should handle null values in override', () => {
    const base = { a: { b: 1 } } as Record<string, unknown>;
    const override = { a: null };
    expect(deepMerge(base, override)).toEqual({ a: null });
  });
});

describe('substitute', () => {
  const vars = {
    inputs: {
      amount: 3200,
      name: 'test',
      isVip: true,
      score: 0.12
    }
  };

  it('should return typed value for exact placeholder (number)', () => {
    const result = substitute('{{ inputs.amount }}', vars);
    expect(result).toBe(3200);
    expect(typeof result).toBe('number');
  });

  it('should return typed value for exact placeholder (boolean)', () => {
    const result = substitute('{{ inputs.isVip }}', vars);
    expect(result).toBe(true);
    expect(typeof result).toBe('boolean');
  });

  it('should return typed value for exact placeholder (string)', () => {
    const result = substitute('{{ inputs.name }}', vars);
    expect(result).toBe('test');
  });

  it('should coerce to string for embedded placeholders', () => {
    const result = substitute('Amount: {{ inputs.amount }} dollars', vars);
    expect(result).toBe('Amount: 3200 dollars');
    expect(typeof result).toBe('string');
  });

  it('should substitute in nested objects', () => {
    const template = { a: { b: '{{ inputs.amount }}' } };
    const result = substitute(template, vars);
    expect(result).toEqual({ a: { b: 3200 } });
  });

  it('should substitute in arrays', () => {
    const template = ['{{ inputs.name }}', 'static', '{{ inputs.amount }}'];
    const result = substitute(template, vars);
    expect(result).toEqual(['test', 'static', 3200]);
  });

  it('should leave non-placeholder strings unchanged', () => {
    expect(substitute('static string', vars)).toBe('static string');
  });

  it('should return null/undefined as-is', () => {
    expect(substitute(null, vars)).toBeNull();
    expect(substitute(undefined, vars)).toBeUndefined();
  });

  it('should return numbers/booleans as-is', () => {
    expect(substitute(42, vars)).toBe(42);
    expect(substitute(true, vars)).toBe(true);
  });

  it('should return empty object as-is', () => {
    expect(substitute({}, vars)).toEqual({});
  });

  it('should throw COMPILATION_ERROR for undefined exact placeholder', () => {
    expect(() => substitute('{{ inputs.nonExistent }}', vars)).toThrow(AppException);
    try {
      substitute('{{ inputs.nonExistent }}', vars);
    } catch (err) {
      expect((err as AppException).errorCode).toBe(ErrorCode.COMPILATION_ERROR);
    }
  });

  it('should throw COMPILATION_ERROR for undefined embedded placeholder', () => {
    expect(() => substitute('val: {{ inputs.nonExistent }}', vars)).toThrow(AppException);
  });

  it('should handle multiple placeholders in one string', () => {
    const result = substitute('{{ inputs.name }}: {{ inputs.amount }}', vars);
    expect(result).toBe('test: 3200');
  });

  it('should handle deeply nested placeholder paths', () => {
    const deepVars = { a: { b: { c: 42 } } };
    expect(substitute('{{ a.b.c }}', deepVars)).toBe(42);
  });
});
