import { BETRIEBSRAT_SIZE, COMPANY, EMPLOYEE_COUNT } from "../seed.config.js";
import { mailLocalPart, samAccount } from "../lib/de.js";
import { addDays, isoDate, parseIsoDate } from "../lib/fmt.js";
import { FIRST_NAMES_F, FIRST_NAMES_M, SURNAMES } from "../lexicons/names.js";
import type { Rng } from "../lib/rand.js";
import type { Department, DepartmentKey, Employee } from "./types.js";

/**
 * Werkzeugbau/Instandhaltung and Lager/Versand are not optional: without them the
 * Lieferscheine, Werkzeugstammkarten and Wartungsprotokolle in the corpus would have no
 * owner in the roster, and a real IT-Leiter would spot that immediately.
 */
export const DEPARTMENTS: readonly Department[] = [
  { key: "gf", name: "Geschäftsführung", adGroup: "GG_GF" },
  { key: "vertrieb", name: "Vertrieb", adGroup: "GG_Vertrieb" },
  { key: "konstruktion", name: "Konstruktion", adGroup: "GG_Konstruktion" },
  { key: "arbeitsvorbereitung", name: "Arbeitsvorbereitung", adGroup: "GG_AV" },
  { key: "fertigung", name: "Fertigung", adGroup: "GG_Fertigung" },
  { key: "werkzeugbau", name: "Werkzeugbau & Instandhaltung", adGroup: "GG_Werkzeugbau" },
  { key: "qs", name: "Qualitätssicherung", adGroup: "GG_QS" },
  { key: "einkauf", name: "Einkauf", adGroup: "GG_Einkauf" },
  { key: "lager", name: "Lager & Versand", adGroup: "GG_Lager" },
  { key: "buchhaltung", name: "Buchhaltung", adGroup: "GG_Buchhaltung" },
  { key: "personal", name: "Personal", adGroup: "GG_Personal" },
  { key: "it", name: "IT", adGroup: "GG_IT" },
];

/**
 * ADDITIONAL unnamed employees per department, on top of the 14 hand-authored cast members.
 * 14 + 128 = 142 = EMPLOYEE_COUNT. Fertigung dominates because a stamping plant is a shop
 * floor with an office attached, not the other way round; a two-person IT department is
 * the Mittelstand norm and both of them are named.
 */
const FILLER_HEADCOUNT: Readonly<Record<DepartmentKey, number>> = {
  gf: 0,
  vertrieb: 8,
  konstruktion: 6,
  arbeitsvorbereitung: 5,
  fertigung: 65,
  werkzeugbau: 14,
  qs: 9,
  einkauf: 4,
  lager: 11,
  buchhaltung: 4,
  personal: 2,
  it: 0,
};

const ROLES: Readonly<Record<DepartmentKey, readonly string[]>> = {
  gf: ["Geschäftsführer"],
  vertrieb: ["Vertriebsinnendienst", "Vertriebsaußendienst", "Kalkulation"],
  konstruktion: ["Konstrukteur", "Technischer Zeichner", "CAD-Konstrukteur"],
  arbeitsvorbereitung: ["Arbeitsvorbereiter", "Fertigungsplaner"],
  fertigung: ["Federnwickler", "Maschinenführer", "Einrichter", "Schichtführer", "Anlagenbediener"],
  werkzeugbau: ["Werkzeugmacher", "Instandhalter", "Zerspanungsmechaniker"],
  qs: ["Qualitätsprüfer", "Messtechniker", "Reklamationsbearbeiter"],
  einkauf: ["Einkäufer", "Disponent"],
  lager: ["Lagerist", "Kommissionierer", "Versandmitarbeiter", "Staplerfahrer"],
  buchhaltung: ["Finanzbuchhalter", "Debitorenbuchhalter"],
  personal: ["Personalsachbearbeiter"],
  it: ["Systembetreuer"],
};

/**
 * The named cast. Hand-authored because the whole narrative hangs off them: the two
 * Geschäftsführer, the retiring costing foreman who is the only one who understands the
 * Kalkulations-Excel, the Betriebsrat chair, and the leaver whose folder still sits on K:\.
 */
interface CastMember {
  readonly id: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly department: DepartmentKey;
  readonly role: string;
  readonly hiredIso: string;
  readonly leftIso?: string;
  readonly isBetriebsrat?: boolean;
  readonly isKeyPerson?: boolean;
}

export const CAST: readonly CastMember[] = [
  { id: "emp:0001", firstName: "Friedrich", lastName: "Selkinghaus", department: "gf",
    role: "Geschäftsführer (technisch), Gesellschafter", hiredIso: "1994-04-01" },
  { id: "emp:0002", firstName: "Bernd", lastName: "Rademacher", department: "gf",
    role: "Geschäftsführer (kaufmännisch), Fremd-GF", hiredIso: "2018-09-01" },
  { id: "emp:0003", firstName: "Marco", lastName: "Hüttemann", department: "vertrieb",
    role: "Vertriebsleiter", hiredIso: "2009-02-16" },
  { id: "emp:0004", firstName: "Karl-Heinz", lastName: "Plaßmann", department: "werkzeugbau",
    role: "Meister Werkzeugbau, Kalkulation", hiredIso: "1983-08-01", isKeyPerson: true },
  { id: "emp:0005", firstName: "Sabine", lastName: "Wiethoff", department: "qs",
    role: "Qualitätsmanagementbeauftragte (QMB)", hiredIso: "2011-05-02" },
  { id: "emp:0006", firstName: "Andrea", lastName: "Kersting", department: "personal",
    role: "Leiterin Personal", hiredIso: "2007-01-08" },
  { id: "emp:0007", firstName: "Dirk", lastName: "Nettelbeck", department: "it",
    role: "IT-Leiter", hiredIso: "2006-03-01" },
  { id: "emp:0008", firstName: "Kai", lastName: "Bönnemann", department: "it",
    role: "Systembetreuer", hiredIso: "2022-08-01" },
  { id: "emp:0009", firstName: "Norbert", lastName: "Stracke", department: "fertigung",
    role: "Einrichter, Betriebsratsvorsitzender", hiredIso: "1998-10-01", isBetriebsrat: true },
  { id: "emp:0010", firstName: "Jörg", lastName: "Eickhoff", department: "konstruktion",
    role: "Leiter Konstruktion", hiredIso: "2013-07-01" },
  { id: "emp:0011", firstName: "Uwe", lastName: "Kalthoff", department: "werkzeugbau",
    role: "Leiter Instandhaltung", hiredIso: "2001-11-05" },
  { id: "emp:0012", firstName: "Petra", lastName: "Lohmann", department: "buchhaltung",
    role: "Leiterin Buchhaltung", hiredIso: "2004-06-01" },
  { id: "emp:0013", firstName: "Thomas", lastName: "Schauerte", department: "einkauf",
    role: "Leiter Einkauf", hiredIso: "2015-03-16" },
  { id: "emp:0014", firstName: "Manfred", lastName: "Grothe", department: "vertrieb",
    role: "Vertriebsaußendienst", hiredIso: "1996-05-01", leftIso: "2021-09-30" },
];

/** Named people whose mail address must stay stable, because documents quote them. */
export const KEY_EMPLOYEES = {
  gfTechnisch: "emp:0001",
  gfKaufmaennisch: "emp:0002",
  vertriebsleiter: "emp:0003",
  kalkulationsMeister: "emp:0004",
  qmb: "emp:0005",
  personalleiterin: "emp:0006",
  itLeiter: "emp:0007",
  betriebsratsvorsitzender: "emp:0009",
  instandhaltung: "emp:0011",
  ausgeschieden: "emp:0014",
} as const;

export function buildEmployees(rng: Rng): Employee[] {
  const cast: Employee[] = CAST.map((member) => ({
    id: member.id,
    firstName: member.firstName,
    lastName: member.lastName,
    department: member.department,
    role: member.role,
    email: `${mailLocalPart(member.firstName, member.lastName)}@${COMPANY.domain}`,
    samAccountName: samAccount(member.firstName, member.lastName),
    hiredIso: member.hiredIso,
    leftIso: member.leftIso ?? null,
    isBetriebsrat: member.isBetriebsrat ?? false,
    isKeyPerson: member.isKeyPerson ?? false,
  }));

  const takenMail = new Set(cast.map((e) => e.email));
  const takenSam = new Set(cast.map((e) => e.samAccountName));
  const baseHire = parseIsoDate("1979-01-01");

  const filler: Employee[] = [];
  let next = cast.length + 1;
  for (const dept of DEPARTMENTS) {
    for (let i = 0; i < FILLER_HEADCOUNT[dept.key]; i++) {
      const female = rng.chance(0.28); // metal trade: the shop floor skews male
      const firstName = rng.pick(female ? FIRST_NAMES_F : FIRST_NAMES_M);
      const lastName = rng.pick(SURNAMES);
      filler.push({
        id: `emp:${String(next).padStart(4, "0")}`,
        firstName,
        lastName,
        department: dept.key,
        role: rng.pick(ROLES[dept.key]),
        email: disambiguate(`${mailLocalPart(firstName, lastName)}@${COMPANY.domain}`, takenMail),
        samAccountName: disambiguate(samAccount(firstName, lastName), takenSam),
        hiredIso: isoDate(addDays(baseHire, rng.int(0, 16_800))),
        leftIso: null,
        isBetriebsrat: false,
        isKeyPerson: false,
      });
      next++;
    }
  }

  // BetrVG §9: 101-200 employees -> 7 members. The chair is already in the cast.
  const missing = BETRIEBSRAT_SIZE - cast.filter((e) => e.isBetriebsrat).length;
  const slots = new Set<number>();
  while (slots.size < missing) slots.add(rng.int(0, filler.length - 1));
  const withBetriebsrat = filler.map((employee, index) =>
    slots.has(index) ? { ...employee, isBetriebsrat: true } : employee,
  );

  const all = [...cast, ...withBetriebsrat];
  if (all.length !== EMPLOYEE_COUNT) {
    throw new Error(`roster has ${all.length} people, EMPLOYEE_COUNT is ${EMPLOYEE_COUNT}`);
  }
  return all;
}

/** Collision suffix, exactly as an admin would add one: "m.mueller2@". */
function disambiguate(candidate: string, taken: Set<string>): string {
  if (!taken.has(candidate)) {
    taken.add(candidate);
    return candidate;
  }
  const at = candidate.indexOf("@");
  const [head, tail] = at === -1 ? [candidate, ""] : [candidate.slice(0, at), candidate.slice(at)];
  for (let n = 2; n < 100; n++) {
    const next = `${head}${n}${tail}`;
    if (!taken.has(next)) {
      taken.add(next);
      return next;
    }
  }
  throw new Error(`cannot disambiguate ${candidate}`);
}
