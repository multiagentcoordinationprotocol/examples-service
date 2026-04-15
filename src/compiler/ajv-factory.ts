import Ajv from 'ajv';
import addFormats from 'ajv-formats';

export function createScenarioAjv(): Ajv {
  const ajv = new Ajv({ allErrors: true, coerceTypes: false });
  addFormats(ajv);
  return ajv;
}
