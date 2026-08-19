import { NextResponse } from "next/server";
import OpenAI from "openai";
import { parseFile, sanitizeExtractedText } from "@/lib/parsers";
import { chunkText } from "@/lib/chunking";
import { computeContentHash, checkDuplicate, replaceDuplicate } from "@/lib/duplicateCheck";
import { supabaseAdmin } from "@/lib/supabase";
import { ERROR_KIND } from "@/lib/friendlyErrors";

const ACCEPTED_EXTENSIONS = ["docx", "pdf", "xlsx", "csv", "pptx", "txt", "jpg", "jpeg", "png"];
const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;
const EMBEDDING_MODEL = "text-embedding-3-large";
const EMBEDDING_BATCH_SIZE = 100;
const STORAGE_BUCKET = "documents";

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

export async function POST(request) {
  let formData;
  try {
    formData = await request.formData();
  } catch (err) {
    return errorResponse(`Could not read upload form data: ${err.message}`, 400);
  }

  const file = formData.get("file");
  if (!file || typeof file === "string") {
    return errorResponse('Missing required field: "file"', 400);
  }

  const fields = {};
  for (const [key, label] of REQUIRED_FIELDS) {
    const value = formData.get(key);
    if (!value || typeof value !== "string" || !value.trim()) {
      return errorResponse(`Missing required field: "${label}" (${key})`, 400);
    }
    fields[key] = value.trim();
  }
  for (const key of OPTIONAL_FIELDS) {
    const value = formData.get(key);
    fields[key] = typeof value === "string" && value.trim() ? value.trim() : null;
  }

  const duplicateAction = formData.get("duplicateAction");

  const filename = file.name;
  const ext = getExtension(filename);
  if (!ACCEPTED_EXTENSIONS.includes(ext)) {
    return errorResponse(
      `Unsupported file extension ".${ext}". Accepted types: ${ACCEPTED_EXTENSIONS.map((e) => `.${e}`).join(", ")}`,
      400,
      ERROR_KIND.UNSUPPORTED_TYPE
    );
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return errorResponse(
      `File is too large (${(file.size / (1024 * 1024)).toFixed(1)}MB). Maximum allowed size is ${
        MAX_FILE_SIZE_BYTES / (1024 * 1024)
      }MB.`,
      400,
      ERROR_KIND.TOO_LARGE
    );
  }

  let buffer;
  try {
    buffer = Buffer.from(await file.arrayBuffer());
  } catch (err) {
    return errorResponse(`Failed to read uploaded file: ${err.message}`, 400);
  }

  let contentHash;
  let duplicateResult;
  try {
    contentHash = computeContentHash(buffer);
    duplicateResult = await checkDuplicate(contentHash);
  } catch (err) {
    return errorResponse(`Duplicate check failed: ${err.message}`, 500, ERROR_KIND.STORAGE_ERROR);
  }

  if (duplicateResult.isDuplicate && duplicateAction !== "replace") {
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
  try {
    text = await parseFile(buffer, filename);
  } catch (err) {
    return errorResponse(`Failed to parse "${filename}": ${err.message}`, 422, ERROR_KIND.PARSE_ERROR);
  }

  text = sanitizeExtractedText(text ?? "");

  if (!text || !text.trim()) {
    return errorResponse(`No extractable text found in "${filename}".`, 422, ERROR_KIND.PARSE_ERROR);
  }

  let chunks;
  try {
    chunks = chunkText(text, { filename });
  } catch (err) {
    return errorResponse(`Failed to chunk extracted text for "${filename}": ${err.message}`, 500, ERROR_KIND.PROCESSING_ERROR);
  }

  if (chunks.length === 0) {
    return errorResponse(`Chunking produced no content for "${filename}".`, 500, ERROR_KIND.PROCESSING_ERROR);
  }

  let embeddings;
  try {
    const openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    embeddings = await generateEmbeddings(openaiClient, chunks);
  } catch (err) {
    return errorResponse(`Failed to generate embeddings for "${filename}": ${err.message}`, 502, ERROR_KIND.PROCESSING_ERROR);
  }

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
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    documentId = document.id;
  } catch (err) {
    return errorResponse(`Failed to create document record for "${filename}": ${err.message}`, 500, ERROR_KIND.STORAGE_ERROR);
  }

  try {
    const rows = chunks.map((chunk, i) => ({
      document_id: documentId,
      content: chunk.content,
      embedding: embeddings[i],
      chunk_index: chunk.chunkIndex,
    }));
    const { error } = await supabaseAdmin.from("chunks").insert(rows);
    if (error) throw new Error(error.message);
  } catch (err) {
    // Don't leave a half-written document behind if the chunk writes failed.
    await supabaseAdmin.from("documents").delete().eq("id", documentId);
    return errorResponse(`Failed to store document chunks for "${filename}": ${err.message}`, 500, ERROR_KIND.STORAGE_ERROR);
  }

  // Store the original file for later download/open. Non-fatal on failure —
  // the document is already fully indexed and searchable at this point, so a
  // document that indexes correctly but can't be re-downloaded is better
  // than treating a secondary feature's failure as a whole-upload failure.
  // storage_path is left null, which the download route treats as "no file".
  try {
    const storagePath = `${documentId}/${filename}`;
    const { error: storageUploadError } = await supabaseAdmin.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, buffer, { contentType: file.type || "application/octet-stream", upsert: false });
    if (storageUploadError) throw new Error(storageUploadError.message);

    const { error: storagePathUpdateError } = await supabaseAdmin
      .from("documents")
      .update({ storage_path: storagePath })
      .eq("id", documentId);
    if (storagePathUpdateError) throw new Error(storagePathUpdateError.message);
  } catch (err) {
    console.error(`Failed to store original file for document "${documentId}" ("${filename}"): ${err.message}`);
  }

  return NextResponse.json({ documentId, chunkCount: chunks.length });
}
