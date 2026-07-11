/**
 * Geography of the Märkischer Kreis. Factual place names and postcodes — the towns are
 * real, the firms placed in them are not. Street names are common German generics, not
 * copied from any address database.
 */

export interface Town {
  readonly name: string;
  readonly plz: string;
}

/** Real towns in and around the Märkischer Kreis. Suppliers and staff live here. */
export const TOWNS: readonly Town[] = [
  { name: "Iserlohn", plz: "58636" },
  { name: "Iserlohn-Sümmern", plz: "58640" },
  { name: "Iserlohn-Letmathe", plz: "58642" },
  { name: "Hemer", plz: "58675" },
  { name: "Menden", plz: "58706" },
  { name: "Lüdenscheid", plz: "58507" },
  { name: "Altena", plz: "58762" },
  { name: "Werdohl", plz: "58791" },
  { name: "Plettenberg", plz: "58840" },
  { name: "Nachrodt-Wiblingwerde", plz: "58769" },
  { name: "Schalksmühle", plz: "58579" },
  { name: "Halver", plz: "58553" },
];

export const STREETS: readonly string[] = [
  "Am Hemberg", "Am Ohl", "Auf dem Brahm", "Bahnhofstraße", "Baarstraße",
  "Bergstraße", "Birkenweg", "Brückenstraße", "Buschstraße", "Dortmunder Straße",
  "Eichenweg", "Feldstraße", "Gartenstraße", "Grüner Weg", "Hauptstraße",
  "Im Hagen", "In der Kalle", "Industriestraße", "Kirchstraße", "Lindenweg",
  "Mühlenstraße", "Nordstraße", "Poststraße", "Ruhrstraße", "Schulstraße",
  "Sonnenweg", "Talstraße", "Wiesenstraße", "Zur Mühle",
];
