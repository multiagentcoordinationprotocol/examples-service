import { HttpStatus } from '@nestjs/common';
import { AppException } from '../errors/app-exception';
import { ErrorCode } from '../errors/error-codes';

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z0-9_.\-]+)\s*\}\}/g;
const EXACT_PLACEHOLDER_RE = /^\{\{\s*([a-zA-Z0-9_.\-]+)\s*\}\}$/;

export interface ScenarioRefParts {
  packSlug: string;
  scenarioSlug: string;
  version: string;
}

export function parseScenarioRef(ref: string): ScenarioRefParts {
  const atIndex = ref.lastIndexOf('@');
  if (atIndex === -1) {
    throw new AppException(
      ErrorCode.INVALID_SCENARIO_REF,
      `invalid scenarioRef: missing '@' in "${ref}"`,
      HttpStatus.BAD_REQUEST
    );
  }

  const path = ref.slice(0, atIndex);
  const version = ref.slice(atIndex + 1);

  const slashIndex = path.indexOf('/');
  if (slashIndex === -1) {
    throw new AppException(
      ErrorCode.INVALID_SCENARIO_REF,
      `invalid scenarioRef: missing '/' in "${ref}"`,
      HttpStatus.BAD_REQUEST
    );
  }

  const packSlug = path.slice(0, slashIndex);
  const scenarioSlug = path.slice(slashIndex + 1);

  if (!packSlug || !scenarioSlug || !version) {
    throw new AppException(
      ErrorCode.INVALID_SCENARIO_REF,
      `invalid scenarioRef: empty component in "${ref}"`,
      HttpStatus.BAD_REQUEST
    );
  }

  return { packSlug, scenarioSlug, version };
}

export function extractSchemaDefaults(schema: Record<string, unknown>): Record<string, unknown> {
  const defaults: Record<string, unknown> = {};
  const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;
  if (!properties) return defaults;

  for (const [key, prop] of Object.entries(properties)) {
    if (prop && 'default' in prop) {
      defaults[key] = prop.default;
    }
  }

  return defaults;
}

export function deepMerge<T extends Record<string, unknown>>(base: T, override: Partial<T>): T {
  const result = { ...base };

  for (const key of Object.keys(override) as Array<keyof T>) {
    const baseVal = base[key];
    const overVal = override[key];

    if (overVal === undefined) continue;

    if (
      baseVal !== null &&
      overVal !== null &&
      typeof baseVal === 'object' &&
      typeof overVal === 'object' &&
      !Array.isArray(baseVal) &&
      !Array.isArray(overVal)
    ) {
      result[key] = deepMerge(
        baseVal as Record<string, unknown>,
        overVal as Record<string, unknown>
      ) as T[keyof T];
    } else {
      result[key] = overVal as T[keyof T];
    }
  }

  return result;
}

function resolvePath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

export function substitute(template: unknown, variables: Record<string, unknown>): unknown {
  if (template === null || template === undefined) {
    return template;
  }

  if (typeof template === 'string') {
    const exactMatch = EXACT_PLACEHOLDER_RE.exec(template);
    if (exactMatch) {
      const resolved = resolvePath(variables, exactMatch[1]);
      if (resolved === undefined) {
        throw new AppException(
          ErrorCode.COMPILATION_ERROR,
          `undefined placeholder: {{ ${exactMatch[1]} }}`,
          HttpStatus.BAD_REQUEST
        );
      }
      return resolved;
    }

    if (PLACEHOLDER_RE.test(template)) {
      PLACEHOLDER_RE.lastIndex = 0;
      return template.replace(PLACEHOLDER_RE, (_match, path: string) => {
        const resolved = resolvePath(variables, path);
        if (resolved === undefined) {
          throw new AppException(
            ErrorCode.COMPILATION_ERROR,
            `undefined placeholder: {{ ${path} }}`,
            HttpStatus.BAD_REQUEST
          );
        }
        return String(resolved);
      });
    }

    return template;
  }

  if (Array.isArray(template)) {
    return template.map((item) => substitute(item, variables));
  }

  if (typeof template === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(template as Record<string, unknown>)) {
      result[key] = substitute(value, variables);
    }
    return result;
  }

  return template;
}
