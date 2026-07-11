/** German-to-ASCII folding, as Windows AD and mail systems do it. "Plaßmann" -> "plassmann". */
const FOLD: ReadonlyMap<string, string> = new Map([
  ["ä", "ae"], ["ö", "oe"], ["ü", "ue"], ["ß", "ss"],
  ["Ä", "Ae"], ["Ö", "Oe"], ["Ü", "Ue"],
]);

export function asciiFold(text: string): string {
  let out = "";
  for (const char of text) out += FOLD.get(char) ?? char;
  return out;
}

/** "Karl-Heinz Plaßmann" -> "karl-heinz.plassmann" */
export function mailLocalPart(firstName: string, lastName: string): string {
  return `${asciiFold(firstName)}.${asciiFold(lastName)}`.toLowerCase();
}

/** AD sAMAccountName, capped at the legacy 20-character limit. "plassmannk" style. */
export function samAccount(firstName: string, lastName: string): string {
  const base = `${asciiFold(lastName)}${asciiFold(firstName).charAt(0)}`
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  return base.slice(0, 20);
}
