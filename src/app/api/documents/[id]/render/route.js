import { NextResponse } from "next/server";
import mammoth from "mammoth";
import { supabaseAdmin } from "@/lib/supabase";

const STORAGE_BUCKET = "documents";

// Server-side render for the in-document highlighting viewer (docx only —
// PDFs are rendered client-side via pdfjs-dist; see PdfViewer.jsx). DOCX has
// no browser-native renderer and no page/position concept in the file
// format itself, so the viewer works against real HTML instead: this route
// converts the stored file to HTML with mammoth (already used for text
// extraction at upload time — same library, different output mode), and the
// client does a DOM text search against the chunk's stored content to find
// and highlight the matching passage.
export async function GET(request, { params }) {
  const { id } = await params;

  const { data: document, error: fetchError } = await supabaseAdmin
    .from("documents")
    .select("id, title, storage_path")
    .eq("id", id)
    .maybeSingle();

  if (fetchError) {
    return NextResponse.json({ error: `Failed to look up document: ${fetchError.message}` }, { status: 500 });
  }
  if (!document) {
    return NextResponse.json({ error: `Document "${id}" not found.` }, { status: 404 });
  }
  if (!document.storage_path) {
    return NextResponse.json(
      { error: "The original file for this document isn't available — it was indexed before file storage was added." },
      { status: 404 }
    );
  }
  if (!document.title.toLowerCase().endsWith(".docx")) {
    return NextResponse.json({ error: "This render endpoint only supports .docx documents." }, { status: 400 });
  }

  const { data: file, error: downloadError } = await supabaseAdmin.storage.from(STORAGE_BUCKET).download(document.storage_path);
  if (downloadError || !file) {
    return NextResponse.json({ error: `Failed to fetch file from storage: ${downloadError?.message ?? "unknown error"}` }, { status: 500 });
  }

  let html;
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await mammoth.convertToHtml({ buffer });
    html = result.value;
  } catch (err) {
    return NextResponse.json({ error: `Failed to render "${document.title}": ${err.message}` }, { status: 500 });
  }

  return NextResponse.json({ html, title: document.title });
}
