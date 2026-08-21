import { createClient } from "@supabase/supabase-js";

// Client-side only: uses the public anon key. Only ever used to PUT a file
// to a pre-authorized signed upload URL (see /api/upload/sign) — the token
// in that URL is what grants the upload, not this key, so this doesn't
// depend on (or need) any Storage RLS policy for the "documents" bucket.
export const supabaseBrowser = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
