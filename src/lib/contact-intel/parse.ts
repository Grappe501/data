import { createHash } from "node:crypto";
import * as XLSX from "xlsx";

export type ContactIntelParsedTable = {
  headers: string[];
  rows: Record<string, string>[];
};

export class ContactIntelUploadError extends Error {
  constructor(
    public readonly code: "file" | "size" | "ext" | "headers" | "rows" | "parse",
    message: string,
  ) {
    super(message);
    this.name = "ContactIntelUploadError";
  }
}

const MAX_ROWS = 20_000;

function sha256Hex(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

export function hashContactIntelBuffer(buf: Buffer): string {
  return sha256Hex(buf);
}

export function hashContactIntelRow(raw: Record<string, string>): string {
  return sha256Hex(JSON.stringify(raw));
}

export function parseContactIntelCsv(text: string): ContactIntelParsedTable {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const nonempty = lines.filter((l, i) => i === 0 || l.trim().length > 0);
  if (nonempty.length === 0) return { headers: [], rows: [] };
  const headers = parseCsvLine(nonempty[0]).map((h) => h.trim());
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < nonempty.length; i++) {
    if (rows.length >= MAX_ROWS) break;
    const cells = parseCsvLine(nonempty[i]);
    const row: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      const key = headers[c];
      if (!key) continue;
      row[key] = (cells[c] ?? "").trim();
    }
    rows.push(row);
  }
  return { headers: headers.filter(Boolean), rows };
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

export function parseContactIntelXlsx(buf: Buffer): ContactIntelParsedTable {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buf, { type: "buffer", raw: false, dense: false, cellFormula: false });
  } catch {
    throw new ContactIntelUploadError("parse", "Could not read that spreadsheet.");
  }
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return { headers: [], rows: [] };
  const sheet = wb.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(sheet, {
    header: 1,
    defval: "",
    raw: false,
    blankrows: false,
  });
  if (matrix.length === 0) return { headers: [], rows: [] };
  const headers = (matrix[0] ?? []).map((h) => String(h ?? "").trim());
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < matrix.length; i++) {
    if (rows.length >= MAX_ROWS) break;
    const cells = matrix[i] ?? [];
    const row: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      const key = headers[c];
      if (!key) continue;
      row[key] = String(cells[c] ?? "").trim();
    }
    rows.push(row);
  }
  return { headers: headers.filter(Boolean), rows };
}

export function parseContactIntelUpload(filename: string, buf: Buffer): ContactIntelParsedTable {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
    return parseContactIntelXlsx(buf);
  }
  return parseContactIntelCsv(buf.toString("utf8"));
}

export const CONTACT_INTEL_MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
export const CONTACT_INTEL_MAX_ROWS = MAX_ROWS;
