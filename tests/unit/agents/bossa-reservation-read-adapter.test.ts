import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  BOSSA_RESERVATION_READ_ADAPTER_ID,
  PRIMARY_PROJECT_ID,
  REQUIRED_PERMISSION,
  RESERVATION_READ_COLUMNS,
  SECONDARY_PROJECT_ID,
  readSyntheticReservation,
} from "@/lib/agents/bossa-reservation-read-adapter";
import {
  BOSSA_TIMEZONE,
  malformedReservationFixture,
  missingReservationRef,
  reservationFixtures,
} from "@/tests/fixtures/bossa-reservation-read-adapter.fixtures";

const ADAPTER_SOURCE = readFileSync(
  new URL("../../../lib/agents/bossa-reservation-read-adapter.ts", import.meta.url),
  "utf8",
);

const TRUSTED_CONTEXT = { timezone: BOSSA_TIMEZONE };

const EXPECTED_DATA_KEYS = [
  "reservation_ref",
  "reservation_status",
  "service_date",
  "service_time",
  "party_size",
  "created_at",
  "updated_at",
].sort();

const FORBIDDEN_KEYS = [
  "organization_id",
  "location_id",
  "lead_id",
  "confirmation_code",
  "guest_name",
  "phone",
  "email",
  "duration_minutes",
  "occasion",
  "notes",
  "source",
  "assigned_user_id",
  "metadata",
  "timezone",
];

function read(
  reservationRef: string,
  rows: readonly unknown[] = reservationFixtures,
  trustedLocationContext: unknown = TRUSTED_CONTEXT,
) {
  return readSyntheticReservation(
    { operation: "read", reservationRef },
    rows,
    trustedLocationContext,
  );
}

describe("BOSSA-RESERVATION-READ-ADAPTER-v1", () => {
  it("uses the governed project and permission envelope", () => {
    const result = read("00000000-0000-4000-8000-000000000002");

    expect(result.adapter_id).toBe(BOSSA_RESERVATION_READ_ADAPTER_ID);
    expect(result.primary_project_id).toBe(PRIMARY_PROJECT_ID);
    expect(result.secondary_project_id).toBe(SECONDARY_PROJECT_ID);
    expect(result.permission_required).toBe(REQUIRED_PERMISSION);
    expect(result.execution_class).toBe("READ");
    expect(REQUIRED_PERMISSION).toBe("reservations.read");
  });

  it.each([
    ["pending", "00000000-0000-4000-8000-000000000001"],
    ["confirmed", "00000000-0000-4000-8000-000000000002"],
    ["seated", "00000000-0000-4000-8000-000000000003"],
    ["completed", "00000000-0000-4000-8000-000000000004"],
    ["cancelled", "00000000-0000-4000-8000-000000000005"],
    ["no_show", "00000000-0000-4000-8000-000000000006"],
  ])("projects %s reservations to the exact allow-list", (status, id) => {
    const result = read(id);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected successful synthetic read");

    expect(Object.keys(result.data).sort()).toEqual(EXPECTED_DATA_KEYS);
    expect(result.data.reservation_status).toBe(status);
    expect(result.data.service_date).toBe("2026-10-06");
    expect(result.data.service_time).toBe("19:30");

    for (const key of FORBIDDEN_KEYS) {
      expect(result.data).not.toHaveProperty(key);
    }
  });

  it("converts stored UTC timestamp to America/Curacao local time", () => {
    const result = read("00000000-0000-4000-8000-000000000002");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected successful synthetic read");
    expect(result.data.service_date).toBe("2026-10-06");
    expect(result.data.service_time).toBe("19:30");
  });

  it("handles calendar-boundary conversion to the previous Curacao date", () => {
    const result = read("00000000-0000-4000-8000-000000000012");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected successful synthetic read");
    expect(result.data.service_date).toBe("2026-10-06");
    expect(result.data.service_time).toBe("22:30");
  });

  it("fails closed for an invalid trusted timezone", () => {
    const result = read(
      "00000000-0000-4000-8000-000000000002",
      reservationFixtures,
      { timezone: "Mars/Olympus" },
    );
    expect(result).toMatchObject({ ok: false, error_code: "INVALID_TIMEZONE" });
  });

  it("fails closed when trusted timezone context is missing", () => {
    const result = readSyntheticReservation(
      { operation: "read", reservationRef: "00000000-0000-4000-8000-000000000002" },
      reservationFixtures,
    );
    expect(result).toMatchObject({ ok: false, error_code: "MISSING_TIMEZONE" });
  });

  it("does not let the agent request override the trusted timezone", () => {
    const result = readSyntheticReservation(
      {
        operation: "read",
        reservationRef: "00000000-0000-4000-8000-000000000002",
        timezone: "UTC",
      },
      reservationFixtures,
      TRUSTED_CONTEXT,
    );
    expect(result).toMatchObject({ ok: false, error_code: "INVALID_REQUEST" });
  });

  it.each([
    "00000000-0000-4000-8000-000000000007",
    "00000000-0000-4000-8000-000000000008",
    "00000000-0000-4000-8000-000000000009",
  ])("does not leak PII or private notes from %s", (id) => {
    const result = read(id);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected successful synthetic read");

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("Synthetic PII Name");
    expect(serialized).not.toContain("+5999000000");
    expect(serialized).not.toContain("pii@example.invalid");
    expect(serialized).not.toContain("Private occasion");
    expect(serialized).not.toContain("Private free-text note");
    expect(serialized).not.toContain("SYNTHETIC-ONLY");
    expect(serialized).not.toContain("America/Curacao");
  });

  it("fails closed for a cross-tenant reservation", () => {
    const result = read("00000000-0000-4000-8000-000000000010");
    expect(result).toMatchObject({ ok: false, error_code: "TENANT_SCOPE_DENIED" });
    expect(result).not.toHaveProperty("data");
  });

  it("fails closed for a missing reservation", () => {
    const result = read(missingReservationRef);
    expect(result).toMatchObject({ ok: false, error_code: "NOT_FOUND" });
  });

  it("fails closed for a malformed reservation", () => {
    const result = read(
      "00000000-0000-4000-8000-000000000011",
      [malformedReservationFixture],
    );
    expect(result).toMatchObject({ ok: false, error_code: "MALFORMED_RESERVATION" });
  });

  it("rejects an attempted write operation", () => {
    const result = readSyntheticReservation(
      {
        operation: "update",
        reservationRef: "00000000-0000-4000-8000-000000000002",
        status: "cancelled",
      },
      reservationFixtures,
      TRUSTED_CONTEXT,
    );

    expect(result).toMatchObject({ ok: false, error_code: "INVALID_REQUEST" });
  });

  it("rejects attempted raw-row access", () => {
    const result = readSyntheticReservation(
      {
        operation: "read",
        reservationRef: "00000000-0000-4000-8000-000000000002",
        includeRaw: true,
      },
      reservationFixtures,
      TRUSTED_CONTEXT,
    );

    expect(result).toMatchObject({ ok: false, error_code: "INVALID_REQUEST" });
  });

  it("declares only the approved future database projection", () => {
    expect(RESERVATION_READ_COLUMNS).toBe(
      "id,status,reservation_at,party_size,created_at,updated_at",
    );
    expect(RESERVATION_READ_COLUMNS).not.toContain("*");
    expect(RESERVATION_READ_COLUMNS).not.toContain("guest_name");
    expect(RESERVATION_READ_COLUMNS).not.toContain("phone");
    expect(RESERVATION_READ_COLUMNS).not.toContain("email");
    expect(RESERVATION_READ_COLUMNS).not.toContain("notes");
  });

  it("contains no production data path, wildcard read, credential, or write primitive", () => {
    expect(ADAPTER_SOURCE).not.toContain('.select("*")');
    expect(ADAPTER_SOURCE).not.toContain(".select('*')");
    expect(ADAPTER_SOURCE).not.toContain("createClient");
    expect(ADAPTER_SOURCE).not.toContain("SUPABASE_SECRET_KEY");
    expect(ADAPTER_SOURCE).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(ADAPTER_SOURCE).not.toContain("fetch(");
    expect(ADAPTER_SOURCE).not.toContain(".insert(");
    expect(ADAPTER_SOURCE).not.toContain(".update(");
    expect(ADAPTER_SOURCE).not.toContain(".delete(");
    expect(ADAPTER_SOURCE).not.toContain(".rpc(");
    expect(ADAPTER_SOURCE).not.toContain("whatsapp_leads");
    expect(ADAPTER_SOURCE).not.toContain("bookings");
  });

  it("contains no availability field because the canonical schema has none", () => {
    const result = read("00000000-0000-4000-8000-000000000002");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected successful synthetic read");
    expect(result.data).not.toHaveProperty("availability_status");
  });
});
