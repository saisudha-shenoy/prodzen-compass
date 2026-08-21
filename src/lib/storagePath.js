// Supabase Storage rejects object keys containing characters outside a safe
// ASCII subset — confirmed directly: a filename with a Unicode curly
// apostrophe (U+2019, e.g. "Buyer's Guide") failed upload with
// "Invalid key: <path>". Normalize common Unicode punctuation to ASCII
// equivalents for readability, strip accents, then replace anything else
// with "_" so no filename can produce an invalid key. Only used for the
// storage key — the human-readable original filename is preserved as-is in
// documents.title.
export function sanitizeStorageFilename(filename) {
  return filename
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]/g, "_");
}

export const STORAGE_BUCKET = "documents";
