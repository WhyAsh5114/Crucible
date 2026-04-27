/**
 * Format a timestamp as a short relative-time string ("5m ago", "3h ago",
 * "2d ago"). Falls back to a locale date for anything older than a week so
 * the rendered text doesn't grow unbounded. Pure function — safe for SSR.
 */
export function formatRelativeTime(input: number | Date, now: number = Date.now()): string {
	const ms = typeof input === 'number' ? input : input.getTime();
	const delta = now - ms;

	if (delta < 30_000) return 'just now';
	if (delta < 60 * 60_000) return `${Math.floor(delta / 60_000)}m ago`;
	if (delta < 24 * 60 * 60_000) return `${Math.floor(delta / (60 * 60_000))}h ago`;
	if (delta < 7 * 24 * 60 * 60_000) return `${Math.floor(delta / (24 * 60 * 60_000))}d ago`;

	return new Date(ms).toLocaleDateString();
}
