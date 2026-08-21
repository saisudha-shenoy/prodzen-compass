import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

const VALID_FEEDBACK = ["helpful", "not_helpful"];

function errorResponse(message, status = 500) {
  return NextResponse.json({ error: message }, { status });
}

// Backs the helpful/not-helpful control on Ask answers — the client already
// has the row's id (returned as `logId` by /api/ask), so this only ever
// updates one existing row's feedback column, never creates one.
export async function PATCH(request, { params }) {
  const { id } = await params;

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return errorResponse(`Could not read request body: ${err.message}`, 400);
  }

  const feedback = body?.feedback;
  if (!VALID_FEEDBACK.includes(feedback)) {
    return errorResponse(`"feedback" must be one of: ${VALID_FEEDBACK.join(", ")}`, 400);
  }

  const { data, error } = await supabaseAdmin.from("activity_log").update({ feedback }).eq("id", id).select("id").maybeSingle();
  if (error) {
    return errorResponse(`Failed to update feedback: ${error.message}`, 500);
  }
  if (!data) {
    return errorResponse(`Activity log entry "${id}" not found.`, 404);
  }

  return NextResponse.json({ success: true });
}
