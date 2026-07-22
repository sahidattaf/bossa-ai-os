/**
 * Typed operational error model (issue #16 rule 8). Every server-side
 * operation — the lib/operations service layer, the dashboard provider, tenant
 * resolution — surfaces one of these codes instead of a raw driver error, so
 * route handlers/pages can render an honest, specific state (permission vs.
 * not-found vs. transient outage) rather than a generic failure.
 */
export const OPERATIONAL_ERROR_CODES = [
  "UNAUTHENTICATED",
  "ORGANIZATION_NOT_FOUND",
  "ORGANIZATION_ACCESS_DENIED",
  "PERMISSION_DENIED",
  "VALIDATION_FAILED",
  "INVALID_STATUS_TRANSITION",
  "RELATED_ENTITY_MISMATCH",
  "DATABASE_UNAVAILABLE",
  "CONFLICT",
  "UNEXPECTED_ERROR",
] as const;

export type OperationalErrorCode = (typeof OPERATIONAL_ERROR_CODES)[number];

const CODE_SET: ReadonlySet<string> = new Set(OPERATIONAL_ERROR_CODES);

export class OperationalError extends Error {
  readonly code: OperationalErrorCode;

  constructor(code: OperationalErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "OperationalError";
    this.code = code;
  }
}

export function unauthenticatedError(): OperationalError {
  return new OperationalError("UNAUTHENTICATED", "Authentication is required for this action.");
}

export function organizationNotFoundError(slug: string): OperationalError {
  return new OperationalError("ORGANIZATION_NOT_FOUND", `Organization "${slug}" was not found.`);
}

export function organizationAccessDeniedError(organizationName: string): OperationalError {
  return new OperationalError(
    "ORGANIZATION_ACCESS_DENIED",
    `You don't have an active membership in "${organizationName}".`,
  );
}

export function permissionDeniedError(permission: string): OperationalError {
  return new OperationalError("PERMISSION_DENIED", `The "${permission}" permission is required for this action.`);
}

export function validationFailedError(message: string): OperationalError {
  return new OperationalError("VALIDATION_FAILED", message);
}

interface PostgrestLikeError {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
}

// Maps a Postgres SQLSTATE to a typed code when the database error carries no
// application-recognized "CODE: message" prefix (see below). Deliberately
// narrow: only the SQLSTATEs this schema's constraints/grants/triggers can
// actually raise are listed, so anything unanticipated falls through to
// UNEXPECTED_ERROR rather than being silently mis-mapped.
const SQLSTATE_TO_CODE: Readonly<Record<string, OperationalErrorCode>> = {
  "23503": "RELATED_ENTITY_MISMATCH", // foreign_key_violation
  "23505": "CONFLICT", // unique_violation
  "23514": "VALIDATION_FAILED", // check_violation
  "42501": "PERMISSION_DENIED", // insufficient_privilege
  "08000": "DATABASE_UNAVAILABLE", // connection_exception
  "08003": "DATABASE_UNAVAILABLE", // connection_does_not_exist
  "08006": "DATABASE_UNAVAILABLE", // connection_failure
  "57P01": "DATABASE_UNAVAILABLE", // admin_shutdown
};

const PREFIX_PATTERN = /^([A-Z_]+):\s*(.*)$/s;

/**
 * Converts a Supabase/PostgREST `{ error }` (from any `.select()/.insert()`
 * call or `.rpc()`) into one OperationalError. Custom database-raised errors
 * that use this project's "CODE: human message" convention (e.g.
 * `enforce_status_transition()`'s "INVALID_STATUS_TRANSITION: ...",
 * `get_dashboard_snapshot()`'s "PERMISSION_DENIED: ...") are parsed by
 * prefix first; anything else is mapped by SQLSTATE; anything still
 * unrecognized becomes UNEXPECTED_ERROR rather than leaking a raw driver
 * error to the UI.
 */
export function toOperationalError(error: PostgrestLikeError | null | undefined): OperationalError {
  if (!error) {
    return new OperationalError("UNEXPECTED_ERROR", "An unexpected error occurred.");
  }

  const message = error.message ?? "An unexpected error occurred.";
  const prefixMatch = message.match(PREFIX_PATTERN);
  // Both capture groups are non-optional in PREFIX_PATTERN, so a successful
  // match always populates prefixMatch[1] and [2].
  if (prefixMatch && CODE_SET.has(prefixMatch[1]!)) {
    return new OperationalError(prefixMatch[1]! as OperationalErrorCode, prefixMatch[2]!, { cause: error });
  }

  const mappedCode = error.code ? SQLSTATE_TO_CODE[error.code] : undefined;
  if (mappedCode) {
    return new OperationalError(mappedCode, message, { cause: error });
  }

  return new OperationalError("UNEXPECTED_ERROR", message, { cause: error });
}

export function isOperationalError(value: unknown): value is OperationalError {
  return value instanceof OperationalError;
}
