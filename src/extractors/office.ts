/**
 * Zero-dependency text extraction for the office formats German SMEs live in:
 * xlsx and docx (OOXML = ZIP + XML, via node:zlib) and PDF text layers
 * (FlateDecode content streams). Deliberately NOT a full parser — it recovers
 * the text an assistant needs to read, not layout or styling.
 */
import { inflateRawSync, inflateSync } from "node:zlib";

// ---------------------------------------------------------------- ZIP reader

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;

interface ZipEntry {
  name: string;
  method: number;
  /** From the central directory — the local header may carry 0 (streamed ZIPs). */
  compressedSize: number;
  localHeaderOffset: number;
}

function readCentralDirectory(buf: Buffer): ZipEntry[] {
  // EOCD sits in the last 64k (comment may follow); scan backwards.
  const scanFrom = Math.max(0, buf.length - 65_557);
  let eocd = -1;
  for (let i = buf.length - 22; i >= scanFrom; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error("not a ZIP archive (no end-of-central-directory)");
  const count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(offset) !== CENTRAL_SIG) throw new Error("corrupt ZIP central directory");
    const method = buf.readUInt16LE(offset + 10);
    const compressedSize = buf.readUInt32LE(offset + 20);
    const nameLength = buf.readUInt16LE(offset + 28);
    const extraLength = buf.readUInt16LE(offset + 30);
    const commentLength = buf.readUInt16LE(offset + 32);
    const localHeaderOffset = buf.readUInt32LE(offset + 42);
    const name = buf.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    entries.push({ name, method, compressedSize, localHeaderOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function readZipEntry(buf: Buffer, entry: ZipEntry): Buffer {
  const o = entry.localHeaderOffset;
  const nameLength = buf.readUInt16LE(o + 26);
  const extraLength = buf.readUInt16LE(o + 28);
  const start = o + 30 + nameLength + extraLength;
  const data = buf.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return Buffer.from(data);
  if (entry.method === 8) return inflateRawSync(data);
  throw new Error(`unsupported ZIP compression method ${entry.method}`);
}

function readZipFile(buf: Buffer, name: string): string | null {
  const entry = readCentralDirectory(buf).find((e) => e.name === name);
  return entry ? readZipEntry(buf, entry).toString("utf8") : null;
}

// ---------------------------------------------------------------- XML helpers

export function decodeXmlEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function attr(tag: string, name: string): string | undefined {
  const m = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(tag);
  return m ? decodeXmlEntities(m[1]!) : undefined;
}

// ---------------------------------------------------------------- DOCX

/** Paragraph text of word/document.xml — tables become one line per row cell. */
export function extractDocx(buf: Buffer): string {
  const xml = readZipFile(buf, "word/document.xml");
  if (xml === null) throw new Error("no word/document.xml — not a docx file");
  const paragraphs = xml.split(/<\/w:p>/);
  const lines: string[] = [];
  for (const p of paragraphs) {
    const texts = [...p.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((m) => decodeXmlEntities(m[1]!));
    const line = texts.join("");
    if (line.trim()) lines.push(line.trim());
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------- XLSX

/** All sheets as labeled row lines; hidden sheets are marked as such. */
export function extractXlsx(buf: Buffer): string {
  const workbook = readZipFile(buf, "xl/workbook.xml");
  if (workbook === null) throw new Error("no xl/workbook.xml — not an xlsx file");
  const rels = readZipFile(buf, "xl/_rels/workbook.xml.rels") ?? "";
  const relTargets = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\s[^>]*\/?>/g)) {
    const id = attr(m[0], "Id");
    const target = attr(m[0], "Target");
    if (id && target) relTargets.set(id, target.replace(/^\//, "").replace(/^(?!xl\/)/, "xl/"));
  }

  const shared: string[] = [];
  const sharedXml = readZipFile(buf, "xl/sharedStrings.xml");
  if (sharedXml) {
    for (const si of sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      const texts = [...si[1]!.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decodeXmlEntities(m[1]!));
      shared.push(texts.join(""));
    }
  }

  const out: string[] = [];
  for (const sheetTag of workbook.matchAll(/<sheet\s[^>]*\/?>/g)) {
    const name = attr(sheetTag[0], "name") ?? "?";
    const state = attr(sheetTag[0], "state") ?? "visible";
    const rid = attr(sheetTag[0], "r:id");
    const target = (rid && relTargets.get(rid)) ?? null;
    const sheetXml = target ? readZipFile(buf, target) : null;
    out.push(`## Blatt "${name}"${state !== "visible" ? ` (${state === "hidden" || state === "veryHidden" ? "ausgeblendet/hidden" : state})` : ""}`);
    if (!sheetXml) continue;
    for (const row of sheetXml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells: string[] = [];
      for (const c of row[1]!.matchAll(/<c(\s[^>]*)?(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1] ?? "";
        const inner = c[2] ?? "";
        const type = /(?:^|\s)t="([^"]*)"/.exec(attrs)?.[1];
        let value = "";
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
        if (type === "s" && v !== undefined) value = shared[Number(v)] ?? "";
        else if (type === "inlineStr") value = [...inner.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decodeXmlEntities(m[1]!)).join("");
        else if (v !== undefined) value = decodeXmlEntities(v);
        cells.push(value);
      }
      const line = cells.join(" ; ").replace(/( ; )+$/, "");
      if (line.trim()) out.push(line);
    }
  }
  return out.join("\n");
}

// ---------------------------------------------------------------- PDF

/** Unescape a PDF literal string: \( \) \\ \n \r \t and \ddd octal. */
export function unescapePdfString(text: string): string {
  return text.replace(/\\(\d{1,3}|.)/g, (_, esc: string) => {
    if (/^\d/.test(esc)) return String.fromCharCode(parseInt(esc, 8));
    const map: Record<string, string> = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" };
    return map[esc] ?? esc;
  });
}

interface PdfStream {
  dict: string;
  data: Buffer;
}

/** Every `<<dict>> stream ... endstream` segment, inflated when FlateDecode. */
function pdfStreams(buf: Buffer): PdfStream[] {
  const streams: PdfStream[] = [];
  let cursor = 0;
  while (cursor < buf.length) {
    const streamStart = buf.indexOf("stream", cursor);
    if (streamStart === -1) break;
    const dictStart = buf.lastIndexOf("<<", streamStart);
    const dict = buf.subarray(Math.max(0, dictStart), streamStart).toString("latin1");
    let dataStart = streamStart + "stream".length;
    if (buf[dataStart] === 0x0d) dataStart++;
    if (buf[dataStart] === 0x0a) dataStart++;
    const streamEnd = buf.indexOf("endstream", dataStart);
    if (streamEnd === -1) break;
    cursor = streamEnd + "endstream".length;
    const raw = buf.subarray(dataStart, streamEnd);
    if (dict.includes("FlateDecode")) {
      try {
        streams.push({ dict, data: inflateSync(raw) });
      } catch {
        /* image or malformed stream — skip */
      }
    } else {
      streams.push({ dict, data: Buffer.from(raw) });
    }
  }
  return streams;
}

interface CMap {
  codeBytes: number;
  map: Map<number, string>;
}

/** Parses a ToUnicode CMap (bfchar + bfrange) into code -> text. */
function parseToUnicodeCmap(text: string): CMap {
  const map = new Map<number, string>();
  let codeBytes = 1;
  const utf16 = (hex: string): string => {
    let s = "";
    for (let i = 0; i < hex.length; i += 4) s += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
    return s;
  };
  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const pair of block[1]!.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) {
      codeBytes = Math.max(1, pair[1]!.length / 2);
      map.set(parseInt(pair[1]!, 16), utf16(pair[2]!));
    }
  }
  for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const triple of block[1]!.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) {
      codeBytes = Math.max(1, triple[1]!.length / 2);
      const from = parseInt(triple[1]!, 16);
      const to = parseInt(triple[2]!, 16);
      const base = parseInt(triple[3]!, 16);
      for (let c = from; c <= to; c++) map.set(c, String.fromCharCode(base + (c - from)));
    }
  }
  return { codeBytes, map };
}

/**
 * Text layer of a PDF. Generated business PDFs embed subsetted fonts whose
 * strings carry glyph codes, not characters — readable only through each
 * font's /ToUnicode CMap. This resolves Tf font switches against those CMaps
 * and decodes Tj/TJ hex and literal strings; the operators Td, TD, T-star
 * and ET break lines. Scanned PDFs without a text layer stay unreadable by
 * design (no OCR).
 */
export function extractPdfText(buf: Buffer): string {
  const pdf = buf.toString("latin1");
  const streams = pdfStreams(buf);

  // Font resource name -> object number. Two shapes exist:
  //   inline:   /Font <</F1 5 0 R /F2 9 0 R>>
  //   indirect: /Font 27 0 R  ->  27 0 obj <</F1 21 0 R /F2 26 0 R>>
  const fontObjects = new Map<string, number>();
  const fontDicts = [...pdf.matchAll(/\/Font\s*<<([\s\S]*?)>>/g)].map((m) => m[1]!);
  for (const ref of pdf.matchAll(/\/Font\s+(\d+)\s+0\s+R/g)) {
    const obj = new RegExp(`(?:^|\\s)${ref[1]}\\s+0\\s+obj\\s*<<([\\s\\S]*?)>>`).exec(pdf);
    if (obj) fontDicts.push(obj[1]!);
  }
  for (const dict of fontDicts) {
    for (const entry of dict.matchAll(/\/(\w+)\s+(\d+)\s+0\s+R/g)) {
      fontObjects.set(entry[1]!, Number(entry[2]!));
    }
  }
  // Font object -> ToUnicode object
  const toUnicodeOf = new Map<number, number>();
  for (const obj of pdf.matchAll(/(\d+)\s+0\s+obj\s*<<([\s\S]*?)>>/g)) {
    const tu = /\/ToUnicode\s+(\d+)\s+0\s+R/.exec(obj[2]!);
    if (tu) toUnicodeOf.set(Number(obj[1]!), Number(tu[1]!));
  }
  // ToUnicode object -> parsed CMap. Object streams are located by matching
  // the "N 0 obj" header right before each stream dict.
  const cmapByObject = new Map<number, CMap>();
  for (const stream of streams) {
    const text = stream.data.toString("latin1");
    if (!text.includes("beginbfchar") && !text.includes("beginbfrange")) continue;
    const headerIndex = pdf.indexOf(stream.dict);
    const before = pdf.slice(Math.max(0, headerIndex - 32), headerIndex);
    const objNum = /(\d+)\s+0\s+obj\s*$/.exec(before)?.[1];
    if (objNum) cmapByObject.set(Number(objNum), parseToUnicodeCmap(text));
  }
  const cmapForFontName = (name: string): CMap | undefined => {
    const fontObj = fontObjects.get(name);
    const tuObj = fontObj !== undefined ? toUnicodeOf.get(fontObj) : undefined;
    return tuObj !== undefined ? cmapByObject.get(tuObj) : undefined;
  };

  const out: string[] = [];
  for (const stream of streams) {
    const content = stream.data.toString("latin1");
    if (!/\b(Tj|TJ)\b/.test(content)) continue;
    let cmap: CMap | undefined;
    let line = "";
    const flush = (): void => {
      if (line.trim()) out.push(line.trim());
      line = "";
    };
    const decodeHex = (hex: string): string => {
      if (!cmap) return "";
      let s = "";
      const step = cmap.codeBytes * 2;
      for (let i = 0; i + step <= hex.length; i += step) {
        s += cmap.map.get(parseInt(hex.slice(i, i + step), 16)) ?? "";
      }
      return s;
    };
    const ops = content.matchAll(
      /\/(\w+)\s+[\d.]+\s+Tf|\((?:\\.|[^\\)])*\)\s*Tj|<[0-9a-fA-F]+>\s*Tj|\[(?:\((?:\\.|[^\\)])*\)|<[0-9a-fA-F]+>|[^\]])*\]\s*TJ|T\*|TD|Td|ET/g,
    );
    for (const op of ops) {
      const token = op[0];
      if (op[1]) {
        cmap = cmapForFontName(op[1]);
        continue;
      }
      if (token === "T*" || token === "TD" || token === "Td" || token === "ET") {
        flush();
        continue;
      }
      for (const part of token.matchAll(/\((?:\\.|[^\\)])*\)|<([0-9a-fA-F]+)>/g)) {
        line += part[1] ? decodeHex(part[1]) : unescapePdfString(part[0].slice(1, -1));
      }
    }
    flush();
  }
  return out.join("\n");
}

// ---------------------------------------------------------------- dispatcher

const EXTRACTORS: Record<string, (buf: Buffer) => string> = {
  ".xlsx": extractXlsx,
  ".docx": extractDocx,
  ".pdf": extractPdfText,
};

export function officeExtensions(): string[] {
  return Object.keys(EXTRACTORS);
}

/** Extracts text if the extension is a supported office format, else null. */
export function extractOfficeText(fileName: string, buf: Buffer): string | null {
  const ext = /\.[^.]+$/.exec(fileName.toLowerCase())?.[0];
  const extractor = ext ? EXTRACTORS[ext] : undefined;
  return extractor ? extractor(buf) : null;
}
