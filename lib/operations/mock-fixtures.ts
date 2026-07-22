/**
 * Static, read-only demo fixtures for the Orders/Reservations/CRM pages in
 * mock mode (issue #16 rule 6 — "keep mock mode functional as an explicitly
 * labeled, read-only demo... never fake persistence"). These are display
 * shapes only, deliberately not the full database Row types: mock mode has
 * no database behind it, so there is nothing to fetch a "detail" record
 * from — only the list view renders in mock mode, with each row disabled.
 * Clearly fictional; not derived from any real customer data.
 */

export interface MockLeadRow {
  id: string;
  contactName: string;
  phone: string;
  leadType: string;
  source: string;
  status: string;
  createdAt: string;
}

export interface MockReservationRow {
  id: string;
  confirmationCode: string;
  guestName: string;
  partySize: number;
  reservationAt: string;
  status: string;
}

export interface MockOrderRow {
  id: string;
  orderNumber: string;
  customerName: string;
  status: string;
  paymentStatus: string;
  total: number;
  currency: string;
}

const BOSSA_LEADS: MockLeadRow[] = [
  {
    id: "mock-lead-bossa-1",
    contactName: "Demo Guest — Maria F.",
    phone: "+5999000001",
    leadType: "reservation",
    source: "whatsapp",
    status: "new",
    createdAt: "2026-07-20T09:00:00Z",
  },
  {
    id: "mock-lead-bossa-2",
    contactName: "Demo Guest — Julio P.",
    phone: "+5999000002",
    leadType: "order",
    source: "website",
    status: "contacted",
    createdAt: "2026-07-20T10:15:00Z",
  },
];

const PAPAI_LEADS: MockLeadRow[] = [
  {
    id: "mock-lead-papai-1",
    contactName: "Demo Guest — Ronnie S.",
    phone: "+5999000020",
    leadType: "reservation",
    source: "social",
    status: "new",
    createdAt: "2026-07-20T09:30:00Z",
  },
];

const BOSSA_RESERVATIONS: MockReservationRow[] = [
  {
    id: "mock-res-bossa-1",
    confirmationCode: "BOSSA-DEMO1",
    guestName: "Demo Guest — Sofia W.",
    partySize: 4,
    reservationAt: "2026-07-20T19:00:00Z",
    status: "confirmed",
  },
  {
    id: "mock-res-bossa-2",
    confirmationCode: "BOSSA-DEMO2",
    guestName: "Demo Guest — Dario C.",
    partySize: 2,
    reservationAt: "2026-07-20T20:00:00Z",
    status: "pending",
  },
];

const PAPAI_RESERVATIONS: MockReservationRow[] = [
  {
    id: "mock-res-papai-1",
    confirmationCode: "PAPAI-DEMO1",
    guestName: "Demo Guest — Ronnie S.",
    partySize: 3,
    reservationAt: "2026-07-20T19:30:00Z",
    status: "confirmed",
  },
];

const BOSSA_ORDERS: MockOrderRow[] = [
  {
    id: "mock-order-bossa-1",
    orderNumber: "BOSSA-DEMO-1001",
    customerName: "Demo Guest — Julio P.",
    status: "completed",
    paymentStatus: "paid",
    total: 67.5,
    currency: "USD",
  },
  {
    id: "mock-order-bossa-2",
    orderNumber: "BOSSA-DEMO-1002",
    customerName: "Demo Guest — Dario C.",
    status: "pending",
    paymentStatus: "unpaid",
    total: 34.56,
    currency: "USD",
  },
];

const PAPAI_ORDERS: MockOrderRow[] = [
  {
    id: "mock-order-papai-1",
    orderNumber: "PAPAI-DEMO-1001",
    customerName: "Demo Guest — Chandra M.",
    status: "completed",
    paymentStatus: "paid",
    total: 48.6,
    currency: "ANG",
  },
];

const LEADS_BY_TENANT_ID: Record<string, MockLeadRow[]> = {
  org_001_bossa: BOSSA_LEADS,
  org_002_papai: PAPAI_LEADS,
};

const RESERVATIONS_BY_TENANT_ID: Record<string, MockReservationRow[]> = {
  org_001_bossa: BOSSA_RESERVATIONS,
  org_002_papai: PAPAI_RESERVATIONS,
};

const ORDERS_BY_TENANT_ID: Record<string, MockOrderRow[]> = {
  org_001_bossa: BOSSA_ORDERS,
  org_002_papai: PAPAI_ORDERS,
};

export function getMockLeads(tenantId: string): MockLeadRow[] {
  return LEADS_BY_TENANT_ID[tenantId] ?? [];
}

export function getMockReservations(tenantId: string): MockReservationRow[] {
  return RESERVATIONS_BY_TENANT_ID[tenantId] ?? [];
}

export function getMockOrders(tenantId: string): MockOrderRow[] {
  return ORDERS_BY_TENANT_ID[tenantId] ?? [];
}
