import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export async function DELETE(request, { params }) {
  const { id } = await params;

  const { data: existing, error: fetchError } = await supabaseAdmin.from("documents").select("id").eq("id", id).maybeSingle();

  if (fetchError) {
    return NextResponse.json({ error: `Failed to look up document: ${fetchError.message}` }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: `Document "${id}" not found.` }, { status: 404 });
  }

  const { error: deleteError } = await supabaseAdmin.from("documents").delete().eq("id", id);
  if (deleteError) {
    return NextResponse.json({ error: `Failed to delete document: ${deleteError.message}` }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
