import { supabaseAdmin } from "./supabase";

// Best-effort, matching the cleanupPendingFile pattern in /api/upload:
// awaited (not true fire-and-forget — a Vercel serverless function can be
// frozen right after it responds, so an un-awaited write might never
// actually land), but wrapped so a logging failure never fails the real
// Search/Ask response it's attached to. Returns the new row's id (used to
// wire up the Ask feedback control) or null if the write failed.
export async function logActivity(entry) {
  try {
    const { data, error } = await supabaseAdmin.from("activity_log").insert(entry).select("id").single();
    if (error) throw new Error(error.message);
    return data.id;
  } catch (err) {
    console.error(`Failed to write activity log entry: ${err.message}`);
    return null;
  }
}
