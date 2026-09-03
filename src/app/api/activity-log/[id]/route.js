import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

const VALID_FEEDBACK = ["helpful", "not_helpful"];
const MAX_FEEDBACK_REASON_LENGTH = 300;

function errorResponse(message, status = 500) {
  return NextResponse.json({ error: message }, { status });
}

// Backs the helpful/not-helpful control on Ask answers — the client already
// has the row's id (returned as `logId` by /api/ask), so this only ever
// updates one existing row's feedback and/or feedback_reason columns, never
// creates one. The two fields are sent in separate requests from the UI (the
// reason follows the initial not-helpful click once the user picks or types
// one), so either may arrive alone — at least one must be present.
export async function PATCH(request, { params }) {
  const { id } = await params;

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return errorResponse(`Could not read request body: ${err.message}`, 400);
  }

  const hasFeedback = Object.prototype.hasOwnProperty.call(body ?? {}, "feedback");
  const hasFeedbackReason = Object.prototype.hasOwnProperty.call(body ?? {}, "feedbackReason");
  if (!hasFeedback && !hasFeedbackReason) {
    return errorResponse('Request must include "feedback" and/or "feedbackReason".', 400);
  }

  const update = {};

  if (hasFeedback) {
    const feedback = body.feedback;
    if (!VALID_FEEDBACK.includes(feedback)) {
      return errorResponse(`"feedback" must be one of: ${VALID_FEEDBACK.join(", ")}`, 400);
    }
    update.feedback = feedback;
  }

  if (hasFeedbackReason) {
    const feedbackReason = typeof body.feedbackReason === "string" ? body.feedbackReason.trim() : "";
    if (!feedbackReason) {
      return errorResponse('"feedbackReason" must be a non-empty string.', 400);
    }
    if (feedbackReason.length > MAX_FEEDBACK_REASON_LENGTH) {
      return errorResponse(`"feedbackReason" must be ${MAX_FEEDBACK_REASON_LENGTH} characters or fewer.`, 400);
    }
    update.feedback_reason = feedbackReason;
  }

  const { data, error } = await supabaseAdmin.from("activity_log").update(update).eq("id", id).select("id").maybeSingle();
  if (error) {
    return errorResponse(`Failed to update feedback: ${error.message}`, 500);
  }
  if (!data) {
    return errorResponse(`Activity log entry "${id}" not found.`, 404);
  }

  return NextResponse.json({ success: true });
}
