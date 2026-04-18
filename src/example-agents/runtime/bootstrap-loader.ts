import * as fs from 'node:fs';
import { BootstrapPayload } from '../../hosting/contracts/bootstrap.types';

export function loadBootstrapPayload(): BootstrapPayload {
  const filePath = process.env.MACP_BOOTSTRAP_FILE;
  if (!filePath) {
    throw new Error('MACP_BOOTSTRAP_FILE is not set');
  }
  const raw = fs.readFileSync(filePath, 'utf-8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`MACP_BOOTSTRAP_FILE (${filePath}) is not valid JSON: ${message}`);
  }
  return parsed as BootstrapPayload;
}

export function hasDirectRuntimeIdentity(bootstrap: BootstrapPayload): boolean {
  return Boolean(bootstrap.runtime_url && bootstrap.auth_token);
}

export function isInitiator(bootstrap: BootstrapPayload): boolean {
  return Boolean(bootstrap.initiator);
}
