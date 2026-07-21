import { createClient } from "@supabase/supabase-js";

// Service-role client for server-only code (API routes, background jobs).
// Bypasses RLS — never expose this client or its key to the browser.
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}
