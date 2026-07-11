/**
 * Windows-1252 encoder.
 *
 * German ERP and DATEV exports are CP1252 with semicolon separators and decimal commas.
 * Node's "latin1" is NOT CP1252: it lacks the 0x80-0x9F block, so the Euro sign encodes
 * as 0xAC instead of 0x80. An agent that assumes UTF-8 reads "Mller" and "1,17 " —
 * which is exactly the encoding trap a real corpus contains, so we reproduce it faithfully.
 */

/** The 0x80-0x9F block, where CP1252 diverges from ISO-8859-1. */
const HIGH_CONTROL_BLOCK: ReadonlyMap<string, number> = new Map([
  ["€", 0x80], // €
  ["‚", 0x82], // ‚
  ["ƒ", 0x83], // ƒ
  ["„", 0x84], // „
  ["…", 0x85], // …
  ["†", 0x86], // †
  ["‡", 0x87], // ‡
  ["ˆ", 0x88], // ˆ
  ["‰", 0x89], // ‰
  ["Š", 0x8a], // Š
  ["‹", 0x8b], // ‹
  ["Œ", 0x8c], // Œ
  ["Ž", 0x8e], // Ž
  ["‘", 0x91], // '
  ["’", 0x92], // '
  ["“", 0x93], // "
  ["”", 0x94], // "
  ["•", 0x95], // •
  ["–", 0x96], // –
  ["—", 0x97], // —
  ["˜", 0x98], // ˜
  ["™", 0x99], // ™
  ["š", 0x9a], // š
  ["›", 0x9b], // ›
  ["œ", 0x9c], // œ
  ["ž", 0x9e], // ž
  ["Ÿ", 0x9f], // Ÿ
]);

const REVERSE_HIGH_BLOCK: ReadonlyMap<number, string> = new Map(
  [...HIGH_CONTROL_BLOCK].map(([char, byte]) => [byte, char]),
);

/** Reads CP1252 bytes back. Needed by the ACL report, which parses the exported acls.csv. */
export function decodeCp1252(bytes: Buffer): string {
  let text = "";
  for (const byte of bytes) {
    text += REVERSE_HIGH_BLOCK.get(byte) ?? String.fromCodePoint(byte);
  }
  return text;
}

/** Characters outside CP1252 become "?" — the same lossy substitution Windows performs. */
export function encodeCp1252(text: string): Buffer {
  const bytes: number[] = [];
  for (const char of text) {
    const special = HIGH_CONTROL_BLOCK.get(char);
    if (special !== undefined) {
      bytes.push(special);
      continue;
    }
    const code = char.codePointAt(0) ?? 0x3f;
    bytes.push(code <= 0xff && !(code >= 0x80 && code <= 0x9f) ? code : 0x3f);
  }
  return Buffer.from(bytes);
}
