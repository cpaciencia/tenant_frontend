export interface DisplayLike {
  id: number
}

/**
 * Picks the first display that isn't the primary one — the screen where the
 * customer-facing window should open. Pure so it can be unit-tested without the
 * Electron `screen` API. Returns null when only the primary display exists.
 */
export function pickExternalDisplay<T extends DisplayLike>(
  displays: T[],
  primaryId: number
): T | null {
  return displays.find((d) => d.id !== primaryId) ?? null
}
