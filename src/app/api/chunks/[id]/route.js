import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

// Used by the in-document viewer (/documents/[id]/view) to fetch the exact
// text to search for and highlight. Search/Ask already return the matched
// chunk's full content directly in their response — this only exists so the
// viewer page (reached by navigating to a URL, not by holding onto that
// response in memory) can look it up again from just a chunk id.
export async function GET(request, { params }) {
  const { id } = await params;

  const { data: chunk, error } = await supabaseAdmin.from("chunks").select("id, document_id, content, page_number").eq("id", id).maybeSingle();

  if (error) {
    return NextResponse.json({ error: `Failed to look up chunk: ${error.message}` }, { status: 500 });
  }
  if (!chunk) {
    return NextResponse.json({ error: `Chunk "${id}" not found.` }, { status: 404 });
  }

  return NextResponse.json({
    id: chunk.id,
    documentId: chunk.document_id,
    content: chunk.content,
    pageNumber: chunk.page_number,
  });
}
