/**
 * Structured JSON log line for spawned agent processes. Writes a single line
 * to stdout. Kept deliberately dependency-free (no Nest Logger) because these
 * helpers run inside worker processes that do not bootstrap the Nest DI
 * container.
 */
type JsonRecord = Record<string, unknown>;

export function logAgent(message: string, details?: JsonRecord): void {
  const payload: JsonRecord = details
    ? { ts: new Date().toISOString(), message, ...details }
    : { ts: new Date().toISOString(), message };
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}
