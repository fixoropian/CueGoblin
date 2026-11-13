const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Turns an epoch timestamp into "just now", "12 min ago", "yesterday"...
 * Older items fall back to a short date so the list stays readable.
 */
export function formatRelativeTime(timestamp: number, now: number = Date.now()): string {
  const elapsed = now - timestamp;

  if (elapsed < MINUTE) return 'just now';
  if (elapsed < HOUR) {
    const minutes = Math.floor(elapsed / MINUTE);
    return `${minutes} min ago`;
  }
  if (elapsed < DAY) {
    const hours = Math.floor(elapsed / HOUR);
    return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
  }
  if (elapsed < 2 * DAY) return 'yesterday';
  if (elapsed < 7 * DAY) return `${Math.floor(elapsed / DAY)} days ago`;

  return new Date(timestamp).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  });
}
