import ExcelJS from "exceljs";

export interface ParsedSheet {
  sheetName: string;
  headers: string[];
  rows: string[][];
  /** Best guess at what each column is for. -1 means "not mapped". */
  guess: {
    frontColumn: number;
    backColumn: number;
    hintColumn: number;
    tagsColumn: number;
    notesColumn: number;
    skipFirstRow: boolean;
  };
  totalRows: number;
  nonEmptyRows: number;
}

export interface ParsedWorkbook {
  filename: string;
  sheets: ParsedSheet[];
}

/** Names we recognise in a header row, mapped to the field they fill. */
const HEADER_HINTS: Record<string, keyof ParsedSheet["guess"]> = {
  front: "frontColumn",
  question: "frontColumn",
  term: "frontColumn",
  word: "frontColumn",
  prompt: "frontColumn",
  q: "frontColumn",
  key: "frontColumn",
  vorderseite: "frontColumn",

  back: "backColumn",
  answer: "backColumn",
  definition: "backColumn",
  meaning: "backColumn",
  translation: "backColumn",
  a: "backColumn",
  value: "backColumn",
  rückseite: "backColumn",

  hint: "hintColumn",
  clue: "hintColumn",
  mnemonic: "hintColumn",

  tag: "tagsColumn",
  tags: "tagsColumn",
  category: "tagsColumn",
  topic: "tagsColumn",

  note: "notesColumn",
  notes: "notesColumn",
  comment: "notesColumn",
  extra: "notesColumn",
  explanation: "notesColumn",
};

/** exceljs cells can be strings, numbers, dates, formulas or rich text. */
function cellToText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);

  if (typeof value === "object") {
    const v = value as Record<string, unknown>;
    if (typeof v.text === "string") return v.text.trim();
    if (typeof v.result === "string" || typeof v.result === "number")
      return String(v.result).trim();
    if (Array.isArray(v.richText))
      return (v.richText as { text?: string }[])
        .map((r) => r.text ?? "")
        .join("")
        .trim();
    if (typeof v.hyperlink === "string") return v.hyperlink;
    if (v.formula !== undefined) return "";
  }
  return String(value).trim();
}

/**
 * Only claim a header row when we actually recognise a label in it.
 *
 * The tempting heuristic — "short cells with no punctuation are probably
 * labels" — misfires on exactly the files people import most: a bare
 * two-column vocabulary list like `uno | one`. Guessing wrong there silently
 * eats a real card, whereas guessing "no header" at worst produces one obvious
 * junk card the user can see in the preview and untick. Bias to the visible
 * failure.
 */
const looksLikeHeader = (cells: string[]): boolean =>
  cells.filter((c) => HEADER_HINTS[c.toLowerCase().trim()]).length >= 1 &&
  cells.filter(Boolean).length >= 2;

function guessColumns(headers: string[], hasHeader: boolean): ParsedSheet["guess"] {
  const guess: ParsedSheet["guess"] = {
    frontColumn: 0,
    backColumn: 1,
    hintColumn: -1,
    tagsColumn: -1,
    notesColumn: -1,
    skipFirstRow: hasHeader,
  };
  if (!hasHeader) return guess;

  let matchedFront = false;
  let matchedBack = false;
  headers.forEach((h, i) => {
    const field = HEADER_HINTS[h.toLowerCase().trim()];
    if (!field) return;
    if (field === "frontColumn" && !matchedFront) {
      guess.frontColumn = i;
      matchedFront = true;
    } else if (field === "backColumn" && !matchedBack) {
      guess.backColumn = i;
      matchedBack = true;
    } else if (field !== "frontColumn" && field !== "backColumn") {
      (guess[field] as number) = i;
    }
  });
  return guess;
}

function buildSheet(sheetName: string, raw: string[][]): ParsedSheet {
  // Trim trailing empty columns and drop fully-empty rows.
  const rows = raw.filter((r) => r.some((c) => c !== ""));
  const width = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const padded = rows.map((r) => {
    const copy = r.slice(0, width);
    while (copy.length < width) copy.push("");
    return copy;
  });

  const first = padded[0] ?? [];
  const hasHeader = padded.length > 1 && looksLikeHeader(first);
  const headers = hasHeader
    ? first.map((h, i) => h || `Column ${i + 1}`)
    : first.map((_, i) => `Column ${i + 1}`);

  return {
    sheetName,
    headers,
    rows: padded,
    guess: guessColumns(headers, hasHeader),
    totalRows: padded.length,
    nonEmptyRows: hasHeader ? Math.max(0, padded.length - 1) : padded.length,
  };
}

export async function parseExcel(
  buffer: Buffer,
  filename: string,
): Promise<ParsedWorkbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);

  const sheets: ParsedSheet[] = [];
  wb.eachSheet((worksheet) => {
    const raw: string[][] = [];
    worksheet.eachRow({ includeEmpty: false }, (row) => {
      // row.values is 1-indexed with a leading hole; slice it off.
      const values = Array.isArray(row.values) ? row.values.slice(1) : [];
      raw.push(values.map(cellToText));
    });
    if (raw.length > 0) {
      sheets.push(buildSheet(worksheet.name || `Sheet ${sheets.length + 1}`, raw));
    }
  });

  return { filename, sheets };
}

/** Minimal RFC 4180 parser — handles quotes, embedded commas and newlines. */
export function parseDelimited(text: string, delimiter = ","): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  const src = text.replace(/^﻿/, ""); // strip BOM

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field.trim());
      field = "";
    } else if (ch === "\n") {
      row.push(field.trim());
      rows.push(row);
      row = [];
      field = "";
    } else if (ch === "\r") {
      /* handled by the \n branch */
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field.trim());
    rows.push(row);
  }
  return rows;
}

export function parseCsv(
  text: string,
  filename: string,
  sheetName = "Sheet 1",
): ParsedWorkbook {
  // Pick whichever delimiter yields more columns on the first line.
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const delimiter =
    (firstLine.match(/\t/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0)
      ? "\t"
      : (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0)
        ? ";"
        : ",";

  const rows = parseDelimited(text, delimiter);
  return { filename, sheets: rows.length ? [buildSheet(sheetName, rows)] : [] };
}

export async function parseAnySpreadsheet(file: File): Promise<ParsedWorkbook> {
  const name = file.name || "upload";
  const lower = name.toLowerCase();
  const buffer = Buffer.from(await file.arrayBuffer());

  if (lower.endsWith(".csv") || lower.endsWith(".tsv") || lower.endsWith(".txt")) {
    return parseCsv(buffer.toString("utf8"), name, name.replace(/\.[^.]+$/, ""));
  }
  return parseExcel(buffer, name);
}
