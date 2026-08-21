import { NextResponse } from "next/server";
import OpenAI from "openai";
import { parseFile, sanitizeExtractedText } from "@/lib/parsers";
import { chunkText } from "@/lib/chunking";
import { computePageBoundaries, findChunkPageNumber } from "@/lib/pdfPages";
import { computeContentHash, checkDuplicate, replaceDuplicate } from "@/lib/duplicateCheck";
import { supabaseAdmin } from "@/lib/supabase";
import { STORAGE_BUCKET } from "@/lib/storagePath";
import { ERROR_KIND } from "@/lib/friendlyErrors";

// Parsing (OCR for scanned PDFs/images in particular) + embedding a large,
// many-page file can take well past Vercel's default serverless function
// timeout (10s on Hobby without this set). A 5.2MB / 44-chunk PDF measured
// at ~16-20s end to end during testing here. 60s is the max allowed on
// Hobby without Fluid Compute; safe to raise further later if a
// legitimately huge file still times out.
export const maxDuration = 60;

const ACCEPTED_EXTENSIONS = ["docx", "pdf", "xlsx", "csv", "pptx", "txt", "jpg", "jpeg", "png"];
const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;
const EMBEDDING_MODEL = "text-embedding-3-large";
const EMBEDDING_BATCH_SIZE = 100;

const REQUIRED_FIELDS = [
  ["documentType", "Document Type"],
  ["dateCreated", "Date Created"],
  ["topicCategory", "Topic / Product Category"],
];

const OPTIONAL_FIELDS = ["client", "author"];

function getExtension(filename) {
  const match = /\.([^.]+)$/.exec(filename ?? "");
  return match ? match[1].toLowerCase() : "";
}

function errorResponse(message, status = 500, kind) {
  return NextResponse.json({ error: message, kind }, { status });
}

// Best-effort — an orphaned pending/ file left behind after a failed
// parse/chunk/embed step is a storage-hygiene concern, not something worth
// failing the (already-failing) request over.
async function cleanupPendingFile(storagePath) {
  try {
    await supabaseAdmin.storage.from(STORAGE_BUCKET).remove([storagePath]);
  } catch {
    // already logged via the caller's own error response; nothing more to do
  }
}

async function generateEmbeddings(client, chunks) {
  const embeddings = [];
  for (let i = 0; i < chunks.length; i += EMBEDDING_BATCH_SIZE) {
    const batch = chunks.slice(i, i + EMBEDDING_BATCH_SIZE);
    const response = await client.embeddings.create({
      model: EMBEDDING_MODEL,
      input: batch.map((chunk) => chunk.content),
    });
    embeddings.push(...response.data.map((item) => item.embedding));
  }
  return embeddings;
}

// The client uploads the raw file directly to Supabase Storage first (see
// /api/upload/sign) and posts only the resulting storage path + metadata
// here — a small JSON body, never the file bytes themselves. See sign/
// route.js's comment for why: Vercel's ~4.5MB serverless request-body limit
// was rejecting anything bigger before this route's own code ever ran, well
// under the 25MB this app has always advertised.
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch (err) {
    return errorResponse(`Could not read request body: ${err.message}`, 400);
  }

  const storagePath = typeof body?.storagePath === "string" ? body.storagePath.trim() : "";
  const filename = typeof body?.filename === "string" ? body.filename.trim() : "";
  if (!storagePath || !storagePath.startsWith("pending/")) {
    return errorResponse('Missing or invalid required field: "storagePath"', 400);
  }
  if (!filename) {
    return errorResponse('Missing required field: "filename"', 400);
  }

  const fields = {};
  for (const [key, label] of REQUIRED_FIELDS) {
    const value = body?.[key];
    if (!value || typeof value !== "string" || !value.trim()) {
      return errorResponse(`Missing required field: "${label}" (${key})`, 400);
    }
    fields[key] = value.trim();
  }
  for (const key of OPTIONAL_FIELDS) {
    const value = body?.[key];
    fields[key] = typeof value === "string" && value.trim() ? value.trim() : null;
  }

  // Only ever "replace" or undefined here — "skip" is resolved entirely
  // client-side via DELETE /api/upload/sign (no document to create, just
  // discarding the file already sitting in Storage), so it never reaches
  // this route.
  const duplicateAction = typeof body?.duplicateAction === "string" ? body.duplicateAction : undefined;

  const ext = getExtension(filename);
  if (!ACCEPTED_EXTENSIONS.includes(ext)) {
    await cleanupPendingFile(storagePath);
    return errorResponse(
      `Unsupported file extension ".${ext}". Accepted types: ${ACCEPTED_EXTENSIONS.map((e) => `.${e}`).join(", ")}`,
      400,
      ERROR_KIND.UNSUPPORTED_TYPE
    );
  }

  let buffer;
  try {
    const { data: fileBlob, error } = await supabaseAdmin.storage.from(STORAGE_BUCKET).download(storagePath);
    if (error) throw new Error(error.message);
    buffer = Buffer.from(await fileBlob.arrayBuffer());
  } catch (err) {
    return errorResponse(`Failed to read uploaded file: ${err.message}`, 400);
  }

  if (buffer.length > MAX_FILE_SIZE_BYTES) {
    await cleanupPendingFile(storagePath);
    return errorResponse(
      `File is too large (${(buffer.length / (1024 * 1024)).toFixed(1)}MB). Maximum allowed size is ${
        MAX_FILE_SIZE_BYTES / (1024 * 1024)
      }MB.`,
      400,
      ERROR_KIND.TOO_LARGE
    );
  }

  let contentHash;
  let duplicateResult;
  try {
    contentHash = computeContentHash(buffer);
    duplicateResult = await checkDuplicate(contentHash);
  } catch (err) {
    await cleanupPendingFile(storagePath);
    return errorResponse(`Duplicate check failed: ${err.message}`, 500, ERROR_KIND.STORAGE_ERROR);
  }

  if (duplicateResult.isDuplicate && duplicateAction !== "replace") {
    // Deliberately not cleaned up here — the client may resubmit this exact
    // storagePath with duplicateAction: "replace" next, reusing the already-
    // uploaded file rather than uploading it a second time.
    return NextResponse.json({
      isDuplicate: true,
      existingDocument: duplicateResult.existingDocument,
    });
  }

  if (duplicateResult.isDuplicate && duplicateAction === "replace") {
    try {
      await replaceDuplicate(duplicateResult.existingDocument.id);
    } catch (err) {
      return errorResponse(`Failed to replace existing document: ${err.message}`, 500, ERROR_KIND.STORAGE_ERROR);
    }
  }

  let text;
  let pages;
  try {
    ({ text, pages } = await parseFile(buffer, filename));
  } catch (err) {
    await cleanupPendingFile(storagePath);
    return errorResponse(`Failed to parse "${filename}": ${err.message}`, 422, ERROR_KIND.PARSE_ERROR);
  }

  text = sanitizeExtractedText(text ?? "");
  // Sanitized identically to `text` above — computePageBoundaries searches
  // for each page's text *within* the sanitized flat text, so an
  // unsanitized page string (e.g. still containing a null byte `text`
  // already had stripped) would silently fail to be found.
  if (pages) pages = pages.map((p) => ({ ...p, text: sanitizeExtractedText(p.text) }));

  if (!text || !text.trim()) {
    await cleanupPendingFile(storagePath);
    return errorResponse(`No extractable text found in "${filename}".`, 422, ERROR_KIND.PARSE_ERROR);
  }

  let chunks;
  try {
    chunks = chunkText(text, { filename });
  } catch (err) {
    await cleanupPendingFile(storagePath);
    return errorResponse(`Failed to chunk extracted text for "${filename}": ${err.message}`, 500, ERROR_KIND.PROCESSING_ERROR);
  }

  if (chunks.length === 0) {
    await cleanupPendingFile(storagePath);
    return errorResponse(`Chunking produced no content for "${filename}".`, 500, ERROR_KIND.PROCESSING_ERROR);
  }

  // PDF-only (see lib/pdfPages.js) — enables a direct page-jump in the
  // in-document viewer instead of a full-document text search every time.
  // null for every other format, and null per-chunk if a chunk's anchor text
  // can't be located (rare; the viewer falls back to text search for those).
  const pageMap = computePageBoundaries(text, pages);
  const chunkPageNumbers = chunks.map((chunk) => findChunkPageNumber(chunk.content, pageMap));

  let embeddings;
  try {
    const openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    embeddings = await generateEmbeddings(openaiClient, chunks);
  } catch (err) {
    await cleanupPendingFile(storagePath);
    return errorResponse(`Failed to generate embeddings for "${filename}": ${err.message}`, 502, ERROR_KIND.PROCESSING_ERROR);
  }

  // The file is already at storagePath in its final resting place — no
  // second upload step needed, just record that path on the document row.
  let documentId;
  try {
    const { data: document, error } = await supabaseAdmin
      .from("documents")
      .insert({
        title: filename,
        client: fields.client,
        document_type: fields.documentType,
        author: fields.author,
        date_created: fields.dateCreated,
        topic_category: fields.topicCategory,
        source_system: "Manual Upload",
        content_hash: contentHash,
        storage_path: storagePath,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    documentId = document.id;
  } catch (err) {
    await cleanupPendingFile(storagePath);
    return errorResponse(`Failed to create document record for "${filename}": ${err.message}`, 500, ERROR_KIND.STORAGE_ERROR);
  }

  try {
    const rows = chunks.map((chunk, i) => ({
      document_id: documentId,
      content: chunk.content,
      embedding: embeddings[i],
      chunk_index: chunk.chunkIndex,
      page_number: chunkPageNumbers[i],
    }));
    const { error } = await supabaseAdmin.from("chunks").insert(rows);
    if (error) throw new Error(error.message);
  } catch (err) {
    // Don't leave a half-written document behind if the chunk writes failed.
    await supabaseAdmin.from("documents").delete().eq("id", documentId);
    await cleanupPendingFile(storagePath);
    return errorResponse(`Failed to store document chunks for "${filename}": ${err.message}`, 500, ERROR_KIND.STORAGE_ERROR);
  }

  return NextResponse.json({ documentId, chunkCount: chunks.length });
}
