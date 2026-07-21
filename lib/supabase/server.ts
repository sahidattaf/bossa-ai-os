import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

import type { Database } from "./database.types";

/**
 * Server Component / Server Action / Route Handler client. Uses the
 * authenticated user's own session (via cookies) — this is what every
 * tenant-scoped query in `supabase` mode goes through, so access is always
 * bounded by RLS + auth.uid(), never a service-role bypass.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component render (no response to attach
            // cookies to). Safe to ignore as long as middleware.ts is
            // refreshing the session on every request.
          }
        },
      },
    },
  );
}
