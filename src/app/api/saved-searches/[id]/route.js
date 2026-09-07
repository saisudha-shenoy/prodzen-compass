import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

function errorResponse(message, status = 500) {
  return NextResponse.json({ error: message }, { status });
}

export async function DELETE(request, { params }) {
  const { id } = await params;

  const { error } = await supabaseAdmin.from("saved_searches").delete().eq("id", id);

  if (error) {
    return errorResponse(`Failed to delete saved search: ${error.message}`, 500);
  }

  return NextResponse.json({ success: true });
}
