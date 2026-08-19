import OpenAI from "openai";
import { supabaseAdmin } from "./supabase.js";

const EMBEDDING_MODEL = "text-embedding-3-large";
const DEFAULT_MATCH_COUNT = 8;

export async function retrieveChunks(query, filters = {}, matchCount = DEFAULT_MATCH_COUNT) {
  let queryEmbedding;
  try {
    const openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await openaiClient.embeddings.create({
      model: EMBEDDING_MODEL,
      input: query,
    });
    queryEmbedding = response.data[0].embedding;
  } catch (err) {
    throw new Error(`Failed to embed query: ${err.message}`);
  }

  const { data, error } = await supabaseAdmin.rpc("match_chunks", {
    query_embedding: queryEmbedding,
    match_count: matchCount,
    filter_client: filters.client ?? null,
    filter_document_type: filters.documentType ?? null,
    filter_author: filters.author ?? null,
    filter_topic_category: filters.topicCategory ?? null,
    filter_date_from: filters.dateFrom ?? null,
    filter_date_to: filters.dateTo ?? null,
  });

  if (error) {
    throw new Error(`match_chunks query failed: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    chunkId: row.chunk_id,
    documentId: row.document_id,
    content: row.content,
    chunkIndex: row.chunk_index,
    similarity: row.similarity,
    title: row.title,
    client: row.client,
    documentType: row.document_type,
    author: row.author,
    dateCreated: row.date_created,
    topicCategory: row.topic_category,
  }));
}

// Pure metadata filtering, no query to embed or rank against — used when the
// user sets filters without typing a search query ("browse by filter").
// Queries the documents table directly rather than match_chunks (which
// requires a query_embedding to order by), so there's no similarity score;
// results are ordered by date_created instead.
export async function browseDocuments(filters = {}, limit = DEFAULT_MATCH_COUNT) {
  let query = supabaseAdmin
    .from("documents")
    .select("id, title, client, document_type, author, date_created, topic_category")
    .order("date_created", { ascending: false })
    .limit(limit);

  if (filters.client) query = query.eq("client", filters.client);
  if (filters.documentType) query = query.eq("document_type", filters.documentType);
  if (filters.author) query = query.eq("author", filters.author);
  if (filters.topicCategory) query = query.eq("topic_category", filters.topicCategory);
  if (filters.dateFrom) query = query.gte("date_created", filters.dateFrom);
  if (filters.dateTo) query = query.lte("date_created", filters.dateTo);

  const { data: documents, error } = await query;
  if (error) {
    throw new Error(`Document browse query failed: ${error.message}`);
  }
  if (!documents || documents.length === 0) {
    return [];
  }

  // One representative chunk per document for the result snippet.
  const { data: chunkRows, error: chunkError } = await supabaseAdmin
    .from("chunks")
    .select("document_id, content")
    .in(
      "document_id",
      documents.map((d) => d.id)
    )
    .eq("chunk_index", 0);
  if (chunkError) {
    throw new Error(`Chunk lookup for browse failed: ${chunkError.message}`);
  }
  const firstChunkByDocument = new Map((chunkRows ?? []).map((c) => [c.document_id, c.content]));

  return documents.map((doc) => ({
    documentId: doc.id,
    content: firstChunkByDocument.get(doc.id) ?? "",
    title: doc.title,
    client: doc.client,
    documentType: doc.document_type,
    author: doc.author,
    dateCreated: doc.date_created,
    topicCategory: doc.topic_category,
    similarity: null,
  }));
}
