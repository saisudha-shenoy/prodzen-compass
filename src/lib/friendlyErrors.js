// User-facing copy for backend failures, grouped by category rather than by
// matching individual raw error strings (which are developer-facing and
// change freely). Routes that can fail in more than one distinguishable way
// (currently just /api/upload) tag their error response with a `kind` from
// ERROR_KIND; routes with only one meaningful failure mode for the user
// (Search, Ask) can omit it and fall through to the generic message.
export const ERROR_KIND = {
  UNSUPPORTED_TYPE: "unsupported_type",
  TOO_LARGE: "too_large",
  PARSE_ERROR: "parse_error",
  PROCESSING_ERROR: "processing_error",
  STORAGE_ERROR: "storage_error",
};

const FRIENDLY_MESSAGES = {
  [ERROR_KIND.UNSUPPORTED_TYPE]: "This file type isn't supported. Please upload a PDF, Word, PowerPoint, Excel, CSV, text, or image file.",
  [ERROR_KIND.TOO_LARGE]: "This file is too large. Please upload a file under 25MB.",
  [ERROR_KIND.PARSE_ERROR]: "We couldn't read this file — it may be corrupted or damaged. Please check the file and try again.",
  [ERROR_KIND.PROCESSING_ERROR]: "Something went wrong while processing this file. Please try again.",
  [ERROR_KIND.STORAGE_ERROR]: "Something went wrong while saving this file. Please try again.",
};

const DEFAULT_MESSAGE = "Something went wrong. Please try again.";

// `error` may be a raw message string, an Error, or a { message, kind }
// shape (e.g. a parsed API error body). The raw message is always logged to
// the console for debugging — it's just never returned for display.
export function getFriendlyErrorMessage(error) {
  const kind = typeof error === "object" && error !== null ? error.kind : undefined;
  const rawMessage = typeof error === "string" ? error : error?.message;

  if (rawMessage) {
    console.error(rawMessage);
  }

  return FRIENDLY_MESSAGES[kind] ?? DEFAULT_MESSAGE;
}
