export const DOC_TYPES = [
  "Market Research Report",
  "Internal Analysis & Comparison",
  "Financial Statement",
  "Client-Supplied Document",
  "Meeting Transcript / Notes",
];

export const INDUSTRIES = [
  "Agriculture & Sustainability",
  "Chemicals Regulation (REACH)",
  "ESG & Sustainability Reporting",
  "ESG Investment / Asset Management",
  "ESG Reporting Software",
  "Hospitality - ESG",
  "Hospitality Market Growth",
  "Internal Methodology",
];

export const SOURCE_SYSTEMS = ["Manual Upload", "SharePoint", "Google Drive", "Confluence", "Salesforce"];

// Kept in sync with ACCEPTED_EXTENSIONS in src/app/api/upload/route.js — this
// is what the server actually accepts, not an aspirational list.
export const ACCEPTED_EXT = ["pdf", "docx", "pptx", "xlsx", "csv", "txt", "jpg", "jpeg", "png"];

export const MAX_UPLOAD_SIZE = 25 * 1024 * 1024;
