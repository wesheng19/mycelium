export const PACIFIC = "America/Los_Angeles";

/**
 * Returns the UTC Date that corresponds to 00:00:00 in Pacific Time
 * on the Pacific calendar day that `d` falls on.
 *
 * Works correctly across PST (UTC-8) / PDT (UTC-7) transitions because
 * Intl.DateTimeFormat resolves the actual offset for the given instant.
 */
export function pacificStartOfDay(d: Date): Date {
  // 1. Determine the Pacific calendar date string, e.g. "2026-04-15".
  //    en-CA produces YYYY-MM-DD ordering.
  const dateStr = new Intl.DateTimeFormat("en-CA", { timeZone: PACIFIC }).format(d);

  // 2. Midnight UTC on that calendar date — a convenient reference point.
  const midnightUTC = new Date(`${dateStr}T00:00:00Z`);

  // 3. Find what Pacific clock time corresponds to midnight UTC.
  //    For PST (UTC-8) this is 16:00 Pacific; for PDT (UTC-7) it is 17:00 Pacific.
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: PACIFIC,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(midnightUTC).map(({ type, value }) => [type, value])
  );
  const offsetMs =
    (parseInt(parts.hour) * 3600 +
      parseInt(parts.minute) * 60 +
      parseInt(parts.second)) *
    1000;

  // 4. Pacific midnight = midnight UTC + (24 h − offset).
  //    e.g. PST: 0:00 UTC + 8 h = 08:00 UTC = 00:00 PST ✓
  return new Date(midnightUTC.getTime() + (86_400_000 - offsetMs));
}
