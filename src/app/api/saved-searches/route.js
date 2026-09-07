import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

// The Search tab's saved-search dropdown only ever shows the most recent 5 —
// enforced here (not just in the client) so the retention rule holds
// regardless of who's calling this route.
const MAX_SAVED_SEARCHES = 5;

function errorResponse(message, status = 500) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from("saved_searches")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(MAX_SAVED_SEARCHES);

  if (error) {
    return errorResponse(`Failed to fetch saved searches: ${error.message}`, 500);
  }

  return NextResponse.json(data);
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch (err) {
    return errorResponse(`Could not read request body: ${err.message}`, 400);
  }

  const query = typeof body?.query === "string" ? body.query : "";
  const filters = body?.filters && typeof body.filters === "object" ? body.filters : {};
  // The dropdown's label is generated from query+filters on the client, not
  // from this column — it just needs a non-empty value to satisfy the
  // table's NOT NULL constraint.
  const name = query.trim() || "All documents";

  const { data, error } = await supabaseAdmin
    .from("saved_searches")
    .insert({ name, query, filters })
    .select()
    .single();

  if (error) {
    return errorResponse(`Failed to save search: ${error.message}`, 500);
  }

  const { data: existing, error: listError } = await supabaseAdmin
    .from("saved_searches")
    .select("id")
    .order("created_at", { ascending: false });

  if (!listError && existing && existing.length > MAX_SAVED_SEARCHES) {
    const staleIds = existing.slice(MAX_SAVED_SEARCHES).map((row) => row.id);
    await supabaseAdmin.from("saved_searches").delete().in("id", staleIds);
  }

  return NextResponse.json(data);
}
