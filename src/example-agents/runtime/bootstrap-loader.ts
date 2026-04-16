import * as fs from 'node:fs';
import { BootstrapPayload } from '../../hosting/contracts/bootstrap.types';

/**
 * Load the BootstrapPayload written by ProcessExampleAgentHostProvider for
 * this spawned agent process. Throws when `MACP_BOOTSTRAP_FILE` is missing or
 * the file is unreadable/invalid — there is no silent fallback; a worker
 * without bootstrap cannot run.
 */
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

/**
 * True when this agent's bootstrap contains a direct-to-runtime identity
 * (gRPC address + Bearer token). Non-initiator agents without tokens fall
 * back to the legacy HTTP bridge.
 */
export function hasDirectRuntimeIdentity(bootstrap: BootstrapPayload): boolean {
  return Boolean(bootstrap.runtime.address && bootstrap.runtime.bearerToken);
}

/** Convenience: is this agent the initiator for its run? */
export function isInitiator(bootstrap: BootstrapPayload): boolean {
  return Boolean(bootstrap.initiator);
}
