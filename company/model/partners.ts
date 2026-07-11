import { SMALL_CUSTOMER_COUNT, SUPPLIER_COUNT } from "../seed.config.js";
import { TOWNS } from "../lexicons/geo.js";
import { SURNAMES } from "../lexicons/names.js";
import type { Rng } from "../lib/rand.js";
import type { Customer, Supplier } from "./types.js";

/**
 * Customers are hand-authored, not generated: the revenue shares carry the cluster-risk
 * story (one Tier-2 customer at 28%) and two of them are referenced by ground-truth
 * questions. All names are invented.
 */
export const KEY_CUSTOMERS: readonly Customer[] = [
  { id: "kun:10001", name: "Wittenbrink Antriebstechnik GmbH", town: "Lüdenscheid",
    plz: "58507", segment: "automotive", revenueShare: 0.28 },
  { id: "kun:10002", name: "Nordhelle Elektrotechnik GmbH & Co. KG", town: "Meinerzhagen",
    plz: "58540", segment: "elektro", revenueShare: 0.14 },
  { id: "kun:10003", name: "Bergstadt Beschläge GmbH & Co. KG", town: "Altena",
    plz: "58762", segment: "beschlaege", revenueShare: 0.11 },
  { id: "kun:10004", name: "Ohlmeyer Hydraulik GmbH", town: "Werdohl",
    plz: "58791", segment: "automotive", revenueShare: 0.09 },
  { id: "kun:10005", name: "Talbach Gerätebau GmbH", town: "Plettenberg",
    plz: "58840", segment: "elektro", revenueShare: 0.07 },
  { id: "kun:10006", name: "Kirchbaum Fördertechnik GmbH", town: "Halver",
    plz: "58553", segment: "sonstige", revenueShare: 0.06 },
  { id: "kun:10007", name: "Sundern Möbelwerke GmbH", town: "Sundern",
    plz: "59846", segment: "beschlaege", revenueShare: 0.05 },
  { id: "kun:10008", name: "Rehsiepen Apparatebau GmbH", town: "Schalksmühle",
    plz: "58579", segment: "sonstige", revenueShare: 0.04 },
];

/** The Tier-2 customer the cluster-risk question and the tribal-price thread hang off. */
export const MAIN_CUSTOMER_ID = "kun:10001";

/** Referenced by the "verbal discount" question that is deliberately unanswerable. */
export const VERBAL_DEAL_CUSTOMER_ID = "kun:10003";

const CUSTOMER_SUFFIXES: readonly string[] = [
  "Metallwaren GmbH", "Systemtechnik GmbH", "Gerätebau GmbH & Co. KG", "Elektro GmbH",
  "Feinmechanik GmbH", "Apparatebau GmbH", "Antriebstechnik GmbH", "Beschlagtechnik GmbH",
];

/**
 * The long tail: 44 small customers sharing the remaining 16 % of revenue. Real Zulieferer
 * carry dozens of these — they are the reason an ERP query for "our customers" is not a
 * five-row answer, and they make entity resolution over 52 names non-trivial.
 */
export function buildSmallCustomers(rng: Rng): Customer[] {
  const namedShare = KEY_CUSTOMERS.reduce((sum, c) => sum + c.revenueShare, 0);
  const remaining = 1 - namedShare;
  const each = Math.round((remaining / SMALL_CUSTOMER_COUNT) * 10_000) / 10_000;
  const stems = rng.shuffle(SURNAMES).slice(0, SMALL_CUSTOMER_COUNT);

  return stems.map((stem, index) => {
    const town = rng.pick(TOWNS);
    return {
      id: `kun:${10009 + index}`,
      name: `${stem} ${rng.pick(CUSTOMER_SUFFIXES)}`,
      town: town.name,
      plz: town.plz,
      segment: rng.pick(["automotive", "elektro", "beschlaege", "sonstige"] as const),
      revenueShare: each,
    };
  });
}

export function buildCustomers(rng: Rng): Customer[] {
  return [...KEY_CUSTOMERS, ...buildSmallCustomers(rng)];
}

const SUPPLY_KINDS: readonly string[] = [
  "Federstahldraht",
  "Bandstahl (Coil)",
  "Galvanik / Verzinkung",
  "Vergüten / Wärmebehandlung",
  "Werkzeugstahl",
  "Verpackungsmaterial",
  "Transport / Spedition",
  "Schmierstoffe",
  "Kugelstrahlmittel",
];

const SUPPLIER_STEMS: readonly string[] = [
  "Rehwinkel", "Ostermeier", "Brammert", "Dahlbrück", "Lennepohl",
  "Hüsemann", "Kortmann", "Sieveking", "Baarbach", "Nöllenberg",
];

export function buildSuppliers(rng: Rng): Supplier[] {
  const stems = [...SUPPLIER_STEMS, ...rng.shuffle(SURNAMES).slice(0, SUPPLIER_COUNT - SUPPLIER_STEMS.length)];
  return stems.map((stem, index) => {
    const town = rng.pick(TOWNS);
    return {
      id: `lie:${20001 + index}`,
      name: `${stem} ${rng.pick(["GmbH", "GmbH & Co. KG", "KG"])}`,
      town: town.name,
      plz: town.plz,
      supplies: rng.pick(SUPPLY_KINDS),
    };
  });
}
