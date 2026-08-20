import path from "node:path";
import { pathToFileURL } from "node:url";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import * as XLSX from "xlsx";
import { OfficeParser } from "officeparser";
import OpenAI from "openai";

// Below this many characters of extracted text, a PDF is treated as scanned/image-only.
const MIN_PDF_TEXT_LENGTH = 50;

// pdfjs-dist (via pdf-parse) resolves its worker script with a dynamic
// `import(this.workerSrc)` that Turbopack rewrites to a bundled chunk path
// which doesn't actually exist at runtime ("Setting up fake worker failed:
// Cannot find module '...\.next\...\pdf.worker.mjs'") — this only surfaces
// once parsing runs through a real Next.js route handler, not when calling
// parseFile() directly from a plain Node script. Pointing pdf-parse at the
// worker file's real absolute path sidesteps Turbopack's bundling of it.
PDFParse.setWorker(pathToFileURL(path.join(process.cwd(), "node_modules/pdf-parse/dist/worker/pdf.worker.mjs")).href);

function getExtension(filename) {
  const match = /\.([^.]+)$/.exec(filename);
  if (!match) {
    throw new Error(`Cannot determine file extension for "${filename}"`);
  }
  return match[1].toLowerCase();
}

function getOpenAIClient() {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

async function parseDocx(buffer, filename) {
  try {
    const { value } = await mammoth.extractRawText({ buffer });
    return value;
  } catch (err) {
    throw new Error(`Failed to parse DOCX file "${filename}": ${err.message}`);
  }
}

async function parsePptx(buffer, filename) {
  try {
    const ast = await OfficeParser.parseOffice(buffer, {
      fileType: "pptx",
      ignoreNotes: false,
    });
    return ast.toText();
  } catch (err) {
    throw new Error(`Failed to parse PPTX file "${filename}": ${err.message}`);
  }
}

async function parseTxt(buffer, filename) {
  try {
    return buffer.toString("utf-8");
  } catch (err) {
    throw new Error(`Failed to parse TXT file "${filename}": ${err.message}`);
  }
}

// Row-major spreadsheets (feature/vendor comparison matrices, etc.) commonly
// have a header row that's far away from the data rows a chunk boundary lands
// on — a plain `cell | cell | cell` dump only makes sense next to that header
// row, so once chunking splits it away, positional values like a lone "Yes"
// can no longer be attributed to the column they're in. Pairing each cell
// with its column header inline makes every row self-contained regardless of
// where it ends up relative to chunk boundaries. Column 0 (e.g. a merged
// "Feature Group" cell that Excel only stores on the group's first row) is
// forward-filled so grouped rows stay labeled after their group header scrolls
// out of the current chunk too.
function sheetToText(sheetName, worksheet) {
  const rows = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    blankrows: false,
    defval: "",
  });
  if (rows.length === 0) return `## Sheet: ${sheetName}`;

  const headers = rows[0].map((h, i) => String(h).trim() || `Column ${i + 1}`);
  let lastGroupValue = "";
  const lines = rows.slice(1).map((row) => {
    if (String(row[0]).trim()) lastGroupValue = String(row[0]).trim();
    else if (lastGroupValue) row[0] = lastGroupValue;

    return headers
      .map((header, i) => (row[i] === "" || row[i] == null ? null : `${header}: ${row[i]}`))
      .filter(Boolean)
      .join(" | ");
  });

  return [`## Sheet: ${sheetName}`, ...lines].join("\n\n");
}

async function parseSpreadsheet(buffer, filename) {
  try {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    return workbook.SheetNames.map((name) =>
      sheetToText(name, workbook.Sheets[name])
    ).join("\n\n");
  } catch (err) {
    throw new Error(`Failed to parse spreadsheet file "${filename}": ${err.message}`);
  }
}

async function extractTextFromImageDataUrl(dataUrl) {
  const client = getOpenAIClient();
  const response = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Transcribe all visible text in this image faithfully and completely. Then briefly describe any non-text visual content (photos, charts, diagrams, etc.).",
          },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
  });
  return response.choices[0].message.content ?? "";
}

async function parseImage(buffer, filename) {
  try {
    const ext = getExtension(filename);
    const mimeType = ext === "png" ? "image/png" : "image/jpeg";
    const dataUrl = `data:${mimeType};base64,${buffer.toString("base64")}`;
    return await extractTextFromImageDataUrl(dataUrl);
  } catch (err) {
    throw new Error(`Failed to parse image file "${filename}": ${err.message}`);
  }
}

// Scanned/image-only PDFs yield almost no text from the PDF text layer. Per the
// PRD requirement to support "PDFs, including scanned documents, with OCR
// fallback", rasterize each page and reuse the same vision-based extraction
// used for image uploads. Returns the same {text, pages} shape as the normal
// text-layer path (see parsePdf) so callers don't need to know which path
// produced it — text keeps the "## Page N" headers for backward
// compatibility with chunks already stored from before per-page tracking
// existed; pages is the same content without the header, for page-number
// lookups (see lib/pdfPages.js). Scanned PDFs have no real text layer, so
// this page_number is the best available anchor — a page-jump, not a
// pixel-precise highlight (there's no OCR-to-image coordinate mapping).
async function ocrScannedPdf(parser) {
  const screenshots = await parser.getScreenshot();
  const pages = [];
  for (const page of screenshots.pages) {
    const text = await extractTextFromImageDataUrl(page.dataUrl);
    pages.push({ num: page.pageNumber, text });
  }
  return {
    text: pages.map((p) => `## Page ${p.num}\n${p.text}`).join("\n\n"),
    pages,
  };
}

// Returns { text, pages } — text is the flattened document text chunking
// already operates on; pages is pdf-parse's per-page breakdown (already
// computed by the library, previously discarded here), used only to derive
// a page_number per chunk after chunking (see lib/pdfPages.js). Chunking
// itself is untouched — it still splits the flat `text` exactly as before.
async function parsePdf(buffer, filename) {
  let parser;
  try {
    parser = new PDFParse({ data: buffer });
    const result = await parser.getText();
    if (result.text.trim().length < MIN_PDF_TEXT_LENGTH) {
      return await ocrScannedPdf(parser);
    }
    return { text: result.text, pages: result.pages.map((p) => ({ num: p.num, text: p.text })) };
  } catch (err) {
    throw new Error(`Failed to parse PDF file "${filename}": ${err.message}`);
  } finally {
    if (parser) await parser.destroy();
  }
}

// Strips bytes/sequences that extracted text can carry over (most commonly from
// PDFs) but that Postgres text columns reject outright: null bytes and unpaired
// UTF-16 surrogates, both of which fail with "unsupported Unicode escape sequence"
// on insert. Applied once here so every format's output is sanitized identically,
// rather than re-implementing this per-parser.
export function sanitizeExtractedText(text) {
  return text
    .replace(/\u0000/g, "")
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");
}

// Always returns { text, pages }. pages is only ever populated for PDFs
// (the only format with a real page concept in the source file) — every
// other format returns pages: null, and downstream code (chunk page-number
// assignment) treats that as "no page data available" rather than an error.
export async function parseFile(buffer, filename) {
  const ext = getExtension(filename);
  switch (ext) {
    case "docx":
      return { text: await parseDocx(buffer, filename), pages: null };
    case "pdf":
      return parsePdf(buffer, filename);
    case "xlsx":
    case "csv":
      return { text: await parseSpreadsheet(buffer, filename), pages: null };
    case "pptx":
      return { text: await parsePptx(buffer, filename), pages: null };
    case "txt":
      return { text: await parseTxt(buffer, filename), pages: null };
    case "jpg":
    case "jpeg":
    case "png":
      return { text: await parseImage(buffer, filename), pages: null };
    default:
      throw new Error(`Unsupported file extension ".${ext}" for file "${filename}"`);
  }
}
