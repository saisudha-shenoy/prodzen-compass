import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

// Caps a single fetch — the Activity Log tab re-queries whenever the date
// range changes, so this bounds one request's size rather than the log's
// total size. Generous for this app's real call volume; raise if a real
// range legitimately needs more.
const MAX_ROWS = 5000;

function errorResponse(message, status = 500) {
  return NextResponse.json({ error: message }, { status });
}

// Powers both the Activity Log tab's table view and its CSV export — same
// query, same rows, so what's downloaded always matches what's on screen.
// from/to are calendar dates (YYYY-MM-DD); bounds are computed in UTC since
// created_at is stored as timestamptz and this is an internal admin tool,
// not something that needs per-user timezone precision.
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  let query = supabaseAdmin.from("activity_log").select("*").order("created_at", { ascending: false }).limit(MAX_ROWS);

  if (from) query = query.gte("created_at", `${from}T00:00:00.000Z`);
  if (to) query = query.lte("created_at", `${to}T23:59:59.999Z`);

  const { data, error } = await query;
  if (error) {
    return errorResponse(`Failed to load activity log: ${error.message}`, 500);
  }

  return NextResponse.json(data ?? []);
}
