import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { STORAGE_BUCKET } from "@/lib/storagePath";

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

  const { data: existing, error: fetchError } = await supabaseAdmin.from("documents").select("id, storage_path").eq("id", id).maybeSingle();

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

  // Best-effort — the documents/chunks rows are already gone at this point
  // (the CASCADE above is what search/Ask actually depend on), so a Storage
  // hiccup here is a hygiene concern, not something worth reporting as a
  // failed delete. Some rows have no storage_path at all (e.g. the Unicode-
  // filename upload-failure case), in which case there's nothing to remove.
  if (existing.storage_path) {
    try {
      await supabaseAdmin.storage.from(STORAGE_BUCKET).remove([existing.storage_path]);
    } catch (err) {
      console.error(`Failed to remove Storage file for deleted document "${id}": ${err.message}`);
    }
  }

  return NextResponse.json({ success: true });
}
