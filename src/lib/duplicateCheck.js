import { createHash } from "node:crypto";
import { supabaseAdmin } from "./supabase.js";

export function computeContentHash(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export async function checkDuplicate(contentHash) {
  const { data, error } = await supabaseAdmin
    .from("documents")
    .select("*")
    .eq("content_hash", contentHash)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to check for duplicate document: ${error.message}`);
  }

  return { isDuplicate: Boolean(data), existingDocument: data ?? null };
}

export async function replaceDuplicate(existingDocumentId) {
  const { error } = await supabaseAdmin
    .from("documents")
    .delete()
    .eq("id", existingDocumentId);

  if (error) {
    throw new Error(`Failed to delete existing document "${existingDocumentId}": ${error.message}`);
  }
}
