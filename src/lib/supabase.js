import { createClient } from "@supabase/supabase-js";

// Server-side only: uses the service role key, which bypasses Row Level Security.
// Only import this in API routes / server code — never in a "use client" component.
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
