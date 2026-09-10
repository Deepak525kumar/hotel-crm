/**
 * How often a screen re-fetches while the user is just looking at it.
 *
 * WHY THIS IS NOT 5 SECONDS ANY MORE. Twelve screens across the two apps
 * polled every 5s. On a phone that is a background radio wake every five
 * seconds for data that changes a few times a shift — the single most
 * expensive thing an idle screen can do to a battery, and these users are
 * mid-shift with no charger.
 *
 * It is not cheap on the other end either. Measured production capacity is
 * ~1000 req/s, and the worker roster is ~610 people. The home screen alone
 * makes three requests per poll, so with the app merely OPEN and untouched:
 *
 *     610 workers x 3 requests / 5s   = ~366 req/s
 *     610 workers x 3 requests / 60s  = ~30 req/s
 *
 * A third of the platform's measured capacity was reserved for screens
 * nobody was interacting with.
 *
 * WHAT PAYS FOR THE LONGER INTERVAL. SWR revalidates on focus by default, so
 * returning to a screen still refreshes it immediately — which is the moment
 * freshness actually matters. Pull-to-refresh remains for "I want it now".
 * The interval only covers a screen left open and stared at, and a minute is
 * well inside how fast a roster changes.
 *
 * Anything that genuinely needs to be near-real-time should say so at its own
 * call site with its own value and a reason, rather than moving this one.
 */
export const POLL_INTERVAL_MS = 60_000;
