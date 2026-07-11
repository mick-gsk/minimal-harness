/**
 * Flat ODF serialisers.
 *
 * The hero documents are authored as .fodt / .fods — single-file, human-readable XML that
 * stays diffable in git. LibreOffice converts them headlessly into real .docx / .xlsx /
 * .pdf, which are then committed as binary fixtures.
 *
 * Why not generate the binaries directly? Because nothing in src/ can read a binary
 * document yet, so a hand-rolled OOXML writer would be ~600 lines serving no consumer
 * (CLAUDE.md principle 6). LibreOffice is a one-time authoring tool, not a dependency:
 * `dependencies: {}` stays empty and `npx tsx company/generate.ts` never invokes it.
 */

export type Block =
  | { kind: "h"; level: 1 | 2; text: string }
  | { kind: "p"; text: string }
  | { kind: "table"; rows: readonly (readonly string[])[] };

export interface Sheet {
  readonly name: string;
  /** Hidden sheets survive the conversion as sheetState="hidden" in the .xlsx. */
  readonly hidden?: boolean;
  readonly rows: readonly (readonly (string | number)[])[];
}

const NS = [
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"',
  'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"',
  'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"',
  'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"',
  'xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"',
].join("\n  ");

export function xmlEscape(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Flat ODF Text. LibreOffice converts this to .docx and to .pdf. */
export function toFodt(blocks: readonly Block[]): string {
  const body = blocks.map(renderBlock).join("\n      ");
  return `<?xml version="1.0" encoding="UTF-8"?>
<office:document
  ${NS}
  office:version="1.2"
  office:mimetype="application/vnd.oasis.opendocument.text">
  <office:automatic-styles>
    <style:style style:name="Tbl" style:family="table">
      <style:table-properties style:width="17cm" table:align="left"/>
    </style:style>
  </office:automatic-styles>
  <office:body>
    <office:text>
      ${body}
    </office:text>
  </office:body>
</office:document>
`;
}

function renderBlock(block: Block, index: number): string {
  if (block.kind === "h") {
    return `<text:h text:outline-level="${block.level}">${xmlEscape(block.text)}</text:h>`;
  }
  if (block.kind === "p") {
    // An empty <text:p/> is how ODF spells a blank line.
    return block.text === "" ? "<text:p/>" : `<text:p>${xmlEscape(block.text)}</text:p>`;
  }
  const columns = block.rows[0]?.length ?? 1;
  const rows = block.rows
    .map((row) => {
      const cells = row
        .map((cell) => `<table:table-cell office:value-type="string"><text:p>${xmlEscape(cell)}</text:p></table:table-cell>`)
        .join("");
      return `<table:table-row>${cells}</table:table-row>`;
    })
    .join("\n        ");
  return `<table:table table:name="T${index}" table:style-name="Tbl">
        <table:table-column table:number-columns-repeated="${columns}"/>
        ${rows}
      </table:table>`;
}

/** Flat ODF Spreadsheet. LibreOffice converts this to .xlsx, hidden sheets included. */
export function toFods(sheets: readonly Sheet[]): string {
  const tables = sheets.map(renderSheet).join("\n      ");
  return `<?xml version="1.0" encoding="UTF-8"?>
<office:document
  ${NS}
  office:version="1.2"
  office:mimetype="application/vnd.oasis.opendocument.spreadsheet">
  <office:automatic-styles>
    <style:style style:name="ta_visible" style:family="table">
      <style:table-properties table:display="true"/>
    </style:style>
    <style:style style:name="ta_hidden" style:family="table">
      <style:table-properties table:display="false"/>
    </style:style>
  </office:automatic-styles>
  <office:body>
    <office:spreadsheet>
      ${tables}
    </office:spreadsheet>
  </office:body>
</office:document>
`;
}

function renderSheet(sheet: Sheet): string {
  const columns = Math.max(...sheet.rows.map((row) => row.length), 1);
  const rows = sheet.rows
    .map((row) => {
      const cells = row.map(renderCell).join("");
      return `<table:table-row>${cells}</table:table-row>`;
    })
    .join("\n        ");
  return `<table:table table:name="${xmlEscape(sheet.name)}" table:style-name="${sheet.hidden ? "ta_hidden" : "ta_visible"}">
        <table:table-column table:number-columns-repeated="${columns}"/>
        ${rows}
      </table:table>`;
}

function renderCell(value: string | number): string {
  if (typeof value === "number") {
    // ODF stores the machine-readable value; the display string is LibreOffice's business.
    return `<table:table-cell office:value-type="float" office:value="${value}"><text:p>${String(value).replace(".", ",")}</text:p></table:table-cell>`;
  }
  if (value === "") return "<table:table-cell/>";
  return `<table:table-cell office:value-type="string"><text:p>${xmlEscape(value)}</text:p></table:table-cell>`;
}
