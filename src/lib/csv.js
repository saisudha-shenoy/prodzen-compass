// RFC4180-style quoting: wrap a field in double quotes (doubling any quotes
// inside it) whenever it contains a comma, quote, or newline — otherwise
// leave it bare.
function csvEscape(value) {
  const str = value === null || value === undefined ? "" : String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function rowsToCsv(headers, rows) {
  const lines = [headers.map(csvEscape).join(",")];
  for (const row of rows) {
    lines.push(row.map(csvEscape).join(","));
  }
  // CRLF line endings for maximum Excel compatibility.
  return lines.join("\r\n");
}

// A UTF-8 BOM prefix is what makes Excel auto-detect UTF-8 instead of
// misrendering non-ASCII characters — Google Sheets/Numbers ignore it
// harmlessly, so it's safe to always include.
const UTF8_BOM = String.fromCharCode(0xfeff);

export function downloadCsv(filename, csvContent) {
  const blob = new Blob([UTF8_BOM + csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
