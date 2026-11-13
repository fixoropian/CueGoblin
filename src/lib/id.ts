/**
 * IDs are generated on the device, never by a server, which keeps capture
 * instant and offline. A timestamp plus randomness is enough for one person's
 * list — no uuid package needed.
 */
export function createId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
