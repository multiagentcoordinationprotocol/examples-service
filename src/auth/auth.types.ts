import { MacpScopes } from '../config/app-config.service';

export { MacpScopes };

/**
 * Result returned by {@link AuthTokenMinterService.mintToken}. Callers receive
 * the Bearer string, its TTL, and the cache outcome so observability metrics
 * can be emitted at the call site without peeking at internals.
 */
export interface MintedToken {
  token: string;
  sender: string;
  expiresAt: number;
  expiresInSeconds: number;
  cacheOutcome: 'hit' | 'miss';
}

/** HTTP request body sent to `auth-service` `POST /tokens`. */
export interface MintRequest {
  sender: string;
  scopes?: MacpScopes;
  ttl_seconds?: number;
}

/** HTTP response body from `auth-service` `POST /tokens`. */
export interface MintResponse {
  token: string;
  sender: string;
  expires_in_seconds: number;
}
