export const BOSSA_ORG_ID = "11111111-1111-4111-8111-111111111111";
export const OTHER_ORG_ID = "22222222-2222-4222-8222-222222222222";

const base = {
  organization_id: BOSSA_ORG_ID,
  location_id: "33333333-3333-4333-8333-333333333333",
  lead_id: "44444444-4444-4444-8444-444444444444",
  confirmation_code: "SYNTHETIC-ONLY",
  guest_name: "Synthetic Guest",
  phone: "+00000000000",
  email: "synthetic@example.invalid",
  party_size: 4,
  reservation_at: "2026-10-06T19:30:00Z",
  duration_minutes: 90,
  occasion: "Synthetic birthday note",
  notes: "Synthetic private note",
  source: "website",
  assigned_user_id: "55555555-5555-4555-8555-555555555555",
  created_at: "2026-10-01T12:00:00Z",
  updated_at: "2026-10-01T12:30:00Z",
};

function row(id: string, status: string, overrides: Record<string, unknown> = {}) {
  return { ...base, id, status, ...overrides };
}

export const reservationFixtures = [
  row("00000000-0000-4000-8000-000000000001", "pending"),
  row("00000000-0000-4000-8000-000000000002", "confirmed"),
  row("00000000-0000-4000-8000-000000000003", "seated"),
  row("00000000-0000-4000-8000-000000000004", "completed"),
  row("00000000-0000-4000-8000-000000000005", "cancelled"),
  row("00000000-0000-4000-8000-000000000006", "no_show"),
  row("00000000-0000-4000-8000-000000000007", "confirmed", {
    guest_name: "Synthetic PII Name",
  }),
  row("00000000-0000-4000-8000-000000000008", "confirmed", {
    phone: "+5999000000",
    email: "pii@example.invalid",
  }),
  row("00000000-0000-4000-8000-000000000009", "confirmed", {
    occasion: "Private occasion",
    notes: "Private free-text note",
  }),
  row("00000000-0000-4000-8000-000000000010", "confirmed", {
    organization_id: OTHER_ORG_ID,
  }),
] as const;

export const malformedReservationFixture = {
  id: "00000000-0000-4000-8000-000000000011",
  organization_id: BOSSA_ORG_ID,
  status: "confirmed",
  reservation_at: "not-a-date",
  party_size: 0,
  created_at: "not-a-date",
  updated_at: "not-a-date",
};

export const missingReservationRef = "00000000-0000-4000-8000-000000000099";
