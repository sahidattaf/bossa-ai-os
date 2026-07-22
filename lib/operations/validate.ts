import type { z } from "zod";

import { validationFailedError } from "@/lib/errors";

/**
 * Parses untrusted input (route/server-action payloads) against a zod
 * schema, converting a failed parse into the same OperationalError shape
 * every other failure mode in lib/operations uses — callers only ever need
 * to catch one error type.
 */
export function parseInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    const message = result.error.issues
      .map((issue) => (issue.path.length > 0 ? `${issue.path.join(".")}: ${issue.message}` : issue.message))
      .join("; ");
    throw validationFailedError(message);
  }
  return result.data;
}
