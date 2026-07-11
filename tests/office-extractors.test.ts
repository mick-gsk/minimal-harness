import { describe, it, expect } from "@jest/globals";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decodeXmlEntities, extractOfficeText, unescapePdfString } from "../src/extractors/office.js";

// __dirname does not exist under native ESM; derive it from import.meta.url.
const __dirname = dirname(fileURLToPath(import.meta.url));

describe("office extractor helpers", () => {
  it("decodes XML entities including numeric ones", () => {
    expect(decodeXmlEntities("R&amp;D &lt;3 &#252;ber &#x00DF;")).toBe("R&D <3 über ß");
  });

  it("unescapes PDF literal strings including octal", () => {
    expect(unescapePdfString("a\\(b\\)c \\134 \\n")).toBe("a(b)c \\ \n");
  });

  it("returns null for non-office extensions", () => {
    expect(extractOfficeText("notes.txt", Buffer.from("hello"))).toBeNull();
  });

  it("rejects office lock files that are not real archives", () => {
    expect(() => extractOfficeText("~$doc.docx", Buffer.from("garbage bytes"))).toThrow(/ZIP/);
  });
});

// Integration against the generated demo-company corpus — skipped when the
// corpus is not present (company/ is a local artifact, not in git).
const CORPUS = join(__dirname, "..", "company", "out", "corpus");
const maybe = existsSync(CORPUS) ? describe : describe.skip;

maybe("office extractors on the demo-company corpus", () => {
  const read = (rel: string): string => extractOfficeText(rel, readFileSync(join(CORPUS, rel))) ?? "";

  it("xlsx: extracts rows and marks hidden sheets", () => {
    const text = read("fileserver/Vertrieb/Kalkulation/Kalkulation_Angebote.xlsx");
    expect(text).toContain('## Blatt "Zuschlag" (ausgeblendet/hidden)');
    expect(text).toContain("DF-12040-DH");
  });

  it("docx: extracts paragraph and table text", () => {
    const text = read("fileserver/Konstruktion/Lastenhefte/Lastenheft_Wittenbrink_Kontaktfeder_Rev2.docx");
    expect(text).toContain("Kontaktkraft bei Nennhub");
    expect(text).toContain("2,4 N ± 0,3 N");
  });

  it("pdf: decodes subsetted-font text via ToUnicode CMaps", () => {
    const text = read("fileserver/QM/Zertifikat_ISO9001_2025.pdf");
    expect(text).toContain("20-QMS-4417");
    expect(text).toContain("31.08.2028");
  });

  it("pdf: scans without a text layer yield empty text (no OCR)", () => {
    const text = read("fileserver/Scans/2026-03-11_Scan_0003.pdf");
    expect(text.trim()).toBe("");
  });
});
