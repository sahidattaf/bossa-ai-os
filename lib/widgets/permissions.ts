/**
 * Phase 1 ships without authentication, so pages pass a wildcard permission
 * set by default. The check itself is real and unit-tested so Phase 2 can
 * plug in a resolved user permission list without touching widget code.
 */
export function hasPermission(granted: readonly string[], required?: string): boolean {
  if (!required) return true;
  return granted.includes("*") || granted.includes(required);
}
