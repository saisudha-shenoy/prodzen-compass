import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { sanitizeStorageFilename, STORAGE_BUCKET } from "@/lib/storagePath";

// Vercel Serverless Functions (Node.js runtime) have a hard ~4.5MB request
// body limit — not configurable, and not the same thing as the 25MB limit
// this app advertises for uploads (that number was only ever checked
// against MAX_FILE_SIZE_BYTES in /api/upload, never against what Vercel
// would actually let through). A 5.2MB PDF was rejected outright with
// FUNCTION_PAYLOAD_TOO_LARGE before /api/upload's own code ever ran, no
// matter how the timeout or in-app size checks were configured.
//
// The fix is to never send the raw file through a Vercel function at all:
// the browser uploads directly to Supabase Storage using a short-lived
// signed URL minted here (server-side, via the service role — the token
// itself is what authorizes the upload, so this doesn't depend on the
// storage bucket's RLS policies), then POSTs just the resulting storage
// path + metadata (a small JSON body) to /api/upload, which downloads the
// file from Storage server-side to run the existing parse/chunk/embed
// pipeline unchanged.
//
// Paths live under "pending/" until /api/upload successfully creates the
// document record, at which point the same path becomes its permanent
// storage_path — no second copy/move step needed.
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch (err) {
    return NextResponse.json({ error: `Could not read request body: ${err.message}` }, { status: 400 });
  }

  const filename = typeof body?.filename === "string" ? body.filename.trim() : "";
  if (!filename) {
    return NextResponse.json({ error: 'Missing required field: "filename"' }, { status: 400 });
  }

  const path = `pending/${crypto.randomUUID()}/${sanitizeStorageFilename(filename)}`;

  const { data, error } = await supabaseAdmin.storage.from(STORAGE_BUCKET).createSignedUploadUrl(path);
  if (error) {
    return NextResponse.json({ error: `Failed to create upload URL: ${error.message}` }, { status: 500 });
  }

  return NextResponse.json({ path, token: data.token });
}

// Cleans up a pending file the client uploaded directly to Storage but
// never submitted to /api/upload — either the user dismissed/skipped it
// (e.g. chose "Skip" on a duplicate-file prompt), or picked a different
// file for a queue entry after already uploading this one. Best-effort:
// an orphaned pending/ file left behind on failure here is a storage-
// hygiene concern, not a user-facing one.
export async function DELETE(request) {
  const path = new URL(request.url).searchParams.get("path");
  if (!path || !path.startsWith("pending/")) {
    return NextResponse.json({ error: 'Missing or invalid "path" query parameter' }, { status: 400 });
  }

  const { error } = await supabaseAdmin.storage.from(STORAGE_BUCKET).remove([path]);
  if (error) {
    return NextResponse.json({ error: `Failed to remove pending file: ${error.message}` }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
