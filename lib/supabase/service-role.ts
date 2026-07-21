import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import type { Database } from "./database.types";

/**
 * Bypasses RLS entirely. Not used by any request path in Phase 2 — reserved
 * for explicit, audited, server-only administration scripts (e.g. future
 * organization provisioning). The `server-only` import makes any accidental
 * client-side import a build error. SUPABASE_SECRET_KEY must never be
 * prefixed NEXT_PUBLIC_ and must never be committed (see .env.example).
 */
export function createServiceRoleClient() {
  const secretKey = process.env.SUPABASE_SECRET_KEY;

  if (!secretKey) {
    throw new Error(
      "SUPABASE_SECRET_KEY is not set. This client must only be used in trusted server-only administration paths.",
    );
  }

  return createSupabaseClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
