import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

function errorResponse(message, status = 500) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from("saved_searches")
    .select("*")
    .order("created_at", { ascending: false });

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

  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) {
    return errorResponse('"name" is required.', 400);
  }

  const query = typeof body?.query === "string" ? body.query : "";
  const filters = body?.filters && typeof body.filters === "object" ? body.filters : {};

  const { data, error } = await supabaseAdmin
    .from("saved_searches")
    .insert({ name, query, filters })
    .select()
    .single();

  if (error) {
    return errorResponse(`Failed to save search: ${error.message}`, 500);
  }

  return NextResponse.json(data);
}
