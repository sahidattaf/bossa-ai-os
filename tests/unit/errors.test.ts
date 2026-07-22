import { describe, expect, it } from "vitest";

import { OperationalError, toOperationalError } from "@/lib/errors";

describe("toOperationalError", () => {
  it("parses this project's 'CODE: message' convention from a custom raised exception", () => {
    const error = toOperationalError({
      message: 'INVALID_STATUS_TRANSITION: order_status cannot go from "pending" to "completed"',
      code: "P0001",
    });

    expect(error).toBeInstanceOf(OperationalError);
    expect(error.code).toBe("INVALID_STATUS_TRANSITION");
    expect(error.message).toBe('order_status cannot go from "pending" to "completed"');
  });

  it("maps foreign_key_violation (23503) to RELATED_ENTITY_MISMATCH", () => {
    const error = toOperationalError({ code: "23503", message: "insert or update on table violates fk" });
    expect(error.code).toBe("RELATED_ENTITY_MISMATCH");
  });

  it("maps unique_violation (23505) to CONFLICT", () => {
    const error = toOperationalError({ code: "23505", message: "duplicate key" });
    expect(error.code).toBe("CONFLICT");
  });

  it("maps check_violation (23514) to VALIDATION_FAILED", () => {
    const error = toOperationalError({ code: "23514", message: "check constraint failed" });
    expect(error.code).toBe("VALIDATION_FAILED");
  });

  it("maps insufficient_privilege (42501) to PERMISSION_DENIED", () => {
    const error = toOperationalError({ code: "42501", message: "permission denied for table orders" });
    expect(error.code).toBe("PERMISSION_DENIED");
  });

  it("falls back to UNEXPECTED_ERROR for an unrecognized SQLSTATE and no prefix", () => {
    const error = toOperationalError({ code: "99999", message: "something odd" });
    expect(error.code).toBe("UNEXPECTED_ERROR");
  });

  it("falls back to UNEXPECTED_ERROR for a null/undefined error", () => {
    expect(toOperationalError(null).code).toBe("UNEXPECTED_ERROR");
    expect(toOperationalError(undefined).code).toBe("UNEXPECTED_ERROR");
  });

  it("does not mis-map a message that merely contains a colon but no recognized code prefix", () => {
    const error = toOperationalError({ message: "Some other module: failed unexpectedly", code: undefined });
    expect(error.code).toBe("UNEXPECTED_ERROR");
  });
});
