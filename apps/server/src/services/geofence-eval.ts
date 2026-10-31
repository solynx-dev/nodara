/**
 * Pure geofence state transition with hysteresis.
 *
 * - A fix whose accuracy circle is much larger than the fence tells us nothing
 *   reliable, so it never changes state.
 * - Entering requires the fix to be inside the radius.
 * - Leaving requires the fix to be outside the radius plus a buffer, so a
 *   person sitting at the edge of a fence does not generate a stream of
 *   arrive/depart events.
 *
 * Returns the new state, and whether a transition event should be emitted.
 */
export function evaluateFence(
  prevInside: boolean | null,
  distanceM: number,
  radiusM: number,
  accuracyM: number | null,
): { inside: boolean | null; event: 'arrive' | 'depart' | null } {
  const acc = accuracyM ?? 30;
  if (acc > Math.max(radiusM * 1.5, 250)) return { inside: prevInside, event: null };

  const buffer = Math.max(25, Math.min(acc, 100));
  if (prevInside === null) {
    // First observation initialises state silently.
    return { inside: distanceM <= radiusM, event: null };
  }
  if (!prevInside && distanceM <= radiusM) return { inside: true, event: 'arrive' };
  if (prevInside && distanceM > radiusM + buffer) return { inside: false, event: 'depart' };
  return { inside: prevInside, event: null };
}
