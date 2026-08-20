import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

// Used by the in-document viewer (/documents/[id]/view) to determine the
// document's format (from title) and whether a stored file even exists,
// before deciding which viewer component to render.
export async function GET(request, { params }) {
  const { id } = await params;

  const { data: document, error } = await supabaseAdmin
    .from("documents")
    .select("id, title, storage_path")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: `Failed to look up document: ${error.message}` }, { status: 500 });
  }
  if (!document) {
    return NextResponse.json({ error: `Document "${id}" not found.` }, { status: 404 });
  }

  return NextResponse.json({ id: document.id, title: document.title, hasFile: Boolean(document.storage_path) });
}

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
