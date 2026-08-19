import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

const STORAGE_BUCKET = "documents";
const SIGNED_URL_EXPIRY_SECONDS = 60;

export async function GET(request, { params }) {
  const { id } = await params;

  const { data: document, error: fetchError } = await supabaseAdmin
    .from("documents")
    .select("id, storage_path")
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

  const { data: signed, error: signError } = await supabaseAdmin.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(document.storage_path, SIGNED_URL_EXPIRY_SECONDS);

  if (signError || !signed?.signedUrl) {
    return NextResponse.json(
      { error: `Failed to generate download link: ${signError?.message ?? "unknown error"}` },
      { status: 500 }
    );
  }

  return NextResponse.redirect(signed.signedUrl, 302);
}
