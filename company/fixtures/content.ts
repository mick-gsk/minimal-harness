/**
 * The hand-authored hero documents.
 *
 * Twenty documents written by a human, not drawn from the PRNG. They carry the entropy a
 * generator cannot fake, and they are the reason "Dokumente in verschiedener vorliegender
 * Form" is true rather than claimed.
 *
 * Numbers that also live in the fact model are IMPORTED, never retyped: the Preisliste
 * quotes HERO_ARTICLE.listPriceEur, the Werkzeugliste quotes DISPUTED_TOOL_LIFE_MASTERCARD.
 * Retyping them would let the corpus drift out of agreement with the ERP.
 */
import {
  DISPUTED_TOOL_LIFE_MASTERCARD, DISPUTED_TOOL_NO, HERO_ARTICLE, HERO_ORDER,
} from "../model/catalog.js";
import { deEuro, deNumber } from "../lib/fmt.js";
import type { Block, Sheet } from "./odf.js";

const H1 = (text: string): Block => ({ kind: "h", level: 1, text });
const H2 = (text: string): Block => ({ kind: "h", level: 2, text });
const P = (text: string): Block => ({ kind: "p", text });
const GAP: Block = { kind: "p", text: "" };
const TABLE = (rows: readonly (readonly string[])[]): Block => ({ kind: "table", rows });

/**
 * The costing factor Plaßmann mentions in his farewell mail. It sits on a HIDDEN sheet and
 * is pulled in by a formula on the visible one — so the visible sheet shows a price whose
 * derivation is invisible. Exactly the spreadsheet every Mittelständler has.
 */
export const ZUSCHLAG_RUESTZEIT = 1.7;

/* -------------------------------------------------------------------------- */
/* Text documents (-> .docx and .pdf)                                          */
/* -------------------------------------------------------------------------- */

export const TEXT_DOCUMENTS: Readonly<Record<string, readonly Block[]>> = {
  "angebot-2024-0871": [
    H1("Angebot 2024-0871"),
    P("Selkinghaus Federn- und Stanztechnik GmbH & Co. KG"),
    P("Im Hagen 14, 58640 Iserlohn-Sümmern"),
    GAP,
    P("An: Wittenbrink Antriebstechnik GmbH, 58507 Lüdenscheid"),
    P("Datum: 18.03.2024"),
    GAP,
    TABLE([
      ["Position", "Artikel", "Menge", "Stückpreis", "Nettowert"],
      [
        "1",
        `${HERO_ARTICLE.articleNo} — ${HERO_ARTICLE.name}`,
        `${deNumber(HERO_ORDER.quantity, 0)} Stück`,
        deEuro(HERO_ARTICLE.listPriceEur),
        deEuro(HERO_ORDER.quantity * HERO_ARTICLE.listPriceEur),
      ],
    ]),
    GAP,
    P("Liefertermin: 28.06.2024, Abruf in vier Teillieferungen."),
    P("Zahlungsziel: 30 Tage netto."),
    P("Werkzeug ist vorhanden, keine Einmalkosten."),
    GAP,
    P("Es gelten unsere Allgemeinen Geschäftsbedingungen."),
    GAP,
    P("i.A. M. Hüttemann, Vertriebsleitung"),
  ],

  "lastenheft-kontaktfeder": [
    H1("Lastenheft Kontaktfeder"),
    P("Auftraggeber: Wittenbrink Antriebstechnik GmbH"),
    P("Revision 2 — 04.09.2025"),
    GAP,
    H2("1 Zweck"),
    P("Die Kontaktfeder stellt die elektrische Verbindung im Schaltgehäuse her. Sie muss über die gesamte Lebensdauer des Antriebs eine definierte Kontaktkraft aufbringen."),
    H2("2 Anforderungen"),
    TABLE([
      ["Nr.", "Anforderung", "Wert", "Prüfung"],
      ["2.1", "Kontaktkraft bei Nennhub", "2,4 N ± 0,3 N", "Federprüfmaschine"],
      ["2.2", "Werkstoff", "CuSn6 (2.1020)", "Werkszeugnis 2.2"],
      ["2.3", "Oberfläche", "elektrolytisch verzinnt, 3 µm", "Schichtdickenmessung"],
      ["2.4", "Dauerfestigkeit", "1 Mio. Lastwechsel", "Dauerlaufprüfung"],
      ["2.5", "Betriebstemperatur", "-40 °C bis +105 °C", "Klimawechseltest"],
    ]),
    H2("3 Mitgeltende Unterlagen"),
    P("DIN EN 13906-1, DIN EN ISO 2768-m."),
    H2("4 Offene Punkte"),
    P("Die Dauerlaufprüfung nach 2.4 kann Selkinghaus nicht im Haus durchführen. Vergabe an ein externes Labor ist noch nicht beauftragt. (Anmerkung J. Eickhoff, 04.09.2025)"),
  ],

  "betriebsvereinbarung-bde": [
    H1("Betriebsvereinbarung über die Betriebsdatenerfassung (BDE)"),
    P("E N T W U R F — Stand 12.02.2026 — noch nicht unterzeichnet"),
    GAP,
    P("zwischen der Selkinghaus Federn- und Stanztechnik GmbH & Co. KG, vertreten durch die Geschäftsführung,"),
    P("und dem Betriebsrat, vertreten durch den Vorsitzenden."),
    GAP,
    H2("§ 1 Gegenstand"),
    P("Diese Vereinbarung regelt die Erfassung und Auswertung von Maschinen- und Auftragsdaten aus dem BDE-System."),
    H2("§ 2 Erfasste Daten"),
    P("Erfasst werden Maschinennummer, Auftragsnummer, Stückzahl, Gut-/Schlechtteile, Stillstandsgründe sowie die Personalnummer des anmeldenden Mitarbeiters."),
    H2("§ 3 Zweckbindung"),
    P("Eine personenbezogene Leistungs- oder Verhaltenskontrolle findet nicht statt. Auswertungen erfolgen ausschließlich maschinen- und auftragsbezogen."),
    H2("§ 4 Zugriff"),
    P("Zugriff auf personenbezogene Rohdaten haben ausschließlich die Geschäftsführung und die Personalabteilung. Der Betriebsrat erhält auf Verlangen Einsicht."),
    H2("§ 5 Inkrafttreten"),
    P("Diese Vereinbarung tritt mit Unterzeichnung durch beide Seiten in Kraft."),
    GAP,
    P("______________________            ______________________"),
    P("Geschäftsführung                  Betriebsrat"),
    GAP,
    P("Anmerkung Personal (A. Kersting, 12.02.2026): Die QS wertet bereits nach § 2 aus. Bitte Unterschrift priorisieren."),
  ],

  "aa-018-stanzen": [
    H1("AA-018 Arbeitsanweisung Stanzen"),
    P("Revision: E"),
    P("Freigegeben: 04.11.2024 durch S. Wiethoff (QMB)"),
    GAP,
    H2("1 Geltungsbereich"),
    P("Gilt für alle Stanz- und Folgeverbundwerkzeuge an den Exzenterpressen in Halle 1 und Halle 3."),
    H2("2 Rüsten"),
    P("Werkzeug nach Werkzeugstammkarte einrichten. Schnitthöhe und Vorschub gemäß Rüstblatt einstellen. Erstes Teil dem Schichtführer vorlegen."),
    H2("3 Vorgabewerte"),
    TABLE([
      ["Merkmal", "Vorgabe"],
      ["Erstmusterfreigabe", "vor Serienstart, durch QS"],
      ["Prüfintervall", "jedes 250. Teil"],
      ["Nachschliff", "nach Vorgabe der Werkzeugstammkarte"],
      ["Schmierung", "Ziehöl Typ 3, dünn aufgetragen"],
    ]),
    H2("4 Dokumentation"),
    P("Prüfergebnisse in QS-Formblatt FB-014 eintragen. Abweichungen sofort dem Schichtführer melden."),
  ],

  "managementreview-2025": [
    H1("Protokoll Managementbewertung 2025"),
    P("nach DIN EN ISO 9001:2015, Abschnitt 9.3"),
    P("Datum: 12.12.2025, Teilnehmer: Geschäftsführung, QMB, Fertigungsleitung"),
    GAP,
    H2("1 Kennzahlen"),
    TABLE([
      ["Kennzahl", "2024", "2025", "Ziel"],
      ["Liefertreue", "93,1 %", "91,4 %", "≥ 95 %"],
      ["Ausschussquote", "1,8 %", "2,1 %", "≤ 1,5 %"],
      ["Reklamationen (Stück)", "17", "19", "≤ 12"],
      ["Kundenzufriedenheit", "2,1", "2,3", "≤ 2,0"],
    ]),
    H2("2 Bewertung"),
    P("Die Liefertreue hat sich verschlechtert. Ursache ist überwiegend der Engpass beim externen Verzinker. Eine zweite Bezugsquelle wurde 2024 beschlossen, aber nicht umgesetzt."),
    H2("3 Zertifizierung"),
    P("Der 2019 begonnene Anlauf zur IATF 16949 wurde aus Kostengründen abgebrochen. Die Automobilkunden decken ihre Forderungen über Kundenaudits ab. Eine Wiederaufnahme wird derzeit nicht verfolgt."),
    H2("4 Maßnahmen"),
    P("M1: Zweitlieferant Galvanik bis 30.06.2026 qualifizieren. Verantwortlich: Einkauf."),
    P("M2: Prüfintervall AA-032 überprüfen; die Fertigung meldet Abweichungen zur freigegebenen Revision. Verantwortlich: QMB."),
    P("M3: Nachfolge Kalkulation regeln. Verantwortlich: Geschäftsführung."),
  ],

  "arbeitszeugnis-grothe": [
    H1("Arbeitszeugnis"),
    P("VERTRAULICH — Personalakte"),
    GAP,
    P("Herr Manfred Grothe, geboren 1963, war vom 01.05.1996 bis zum 30.09.2021 in unserem Unternehmen als Mitarbeiter im Vertriebsaußendienst tätig."),
    GAP,
    P("Zu seinen Aufgaben gehörten die Betreuung der Bestandskunden im Märkischen Kreis, die Erstellung von Angebotskalkulationen sowie die Begleitung von Erstmusterfreigaben."),
    GAP,
    P("Herr Grothe verfügte über fundierte Fachkenntnisse und setzte diese stets sicher und zielführend ein. Er erledigte die ihm übertragenen Aufgaben stets zu unserer vollsten Zufriedenheit."),
    GAP,
    P("Das Arbeitsverhältnis endete auf eigenen Wunsch des Mitarbeiters. Wir bedauern sein Ausscheiden und wünschen ihm für die Zukunft alles Gute."),
    GAP,
    P("Iserlohn-Sümmern, 30.09.2021"),
    P("F. Selkinghaus, Geschäftsführung"),
  ],

  "qm-handbuch": [
    H1("Qualitätsmanagementhandbuch"),
    P("Revision 7 — freigegeben am 28.08.2025"),
    GAP,
    H2("1 Anwendungsbereich"),
    P("Der Geltungsbereich umfasst Entwicklung und Fertigung von Federn, Stanz- und Drahtbiegeteilen am Standort Iserlohn-Sümmern."),
    H2("2 Zertifizierung"),
    P("Das Unternehmen ist nach DIN EN ISO 9001:2015 zertifiziert."),
    P("Hinweis: Der 2019 begonnene Anlauf zur Zertifizierung nach IATF 16949 wurde aus Kostengründen abgebrochen. Kundenspezifische Forderungen der Automobilkunden werden im Rahmen von Kundenaudits abgedeckt."),
    H2("3 Dokumentenlenkung"),
    P("Alle freigegebenen Dokumente sind in der Dokumentenlenkungsliste geführt. Ausschließlich die dort genannte Revision ist gültig. Kopien außerhalb des Ordners QM\\freigegeben gelten als nicht gelenkt."),
    H2("4 Prozesse"),
    TABLE([
      ["Prozess", "Verantwortlich", "Nachweis"],
      ["Angebot und Auftrag", "Vertrieb", "Angebot, Auftragsbestätigung"],
      ["Konstruktion", "Konstruktion", "Zeichnung, Lastenheft"],
      ["Beschaffung", "Einkauf", "Bestellung, Wareneingangsprüfung"],
      ["Fertigung", "Fertigung", "Arbeitsanweisung, BDE"],
      ["Prüfung", "Qualitätssicherung", "Prüfprotokoll FB-014"],
      ["Reklamation", "Qualitätssicherung", "8D-Report"],
    ]),
  ],

  "zeichnung-df12040": [
    H1("Technische Zeichnung"),
    P(`Zeichnungsnummer: ${HERO_ARTICLE.articleNo}`),
    P("Revision: 3 — 11.01.2023"),
    GAP,
    TABLE([
      ["Merkmal", "Wert", "Toleranz"],
      ["Außendurchmesser De", "12,00 mm", "± 0,15 mm"],
      ["Länge L0", "40,00 mm", "± 0,50 mm"],
      ["Drahtdurchmesser d", "1,25 mm", "± 0,02 mm"],
      ["Windungszahl n", "7,5", "—"],
      ["Federrate R", "4,80 N/mm", "± 8 %"],
      ["Werkstoff", "Federstahldraht DH nach DIN EN 10270-1", "—"],
      ["Oberfläche", "verzinkt-blau, 5 µm", "—"],
    ]),
    GAP,
    P("Berechnung nach DIN EN 13906-1. Allgemeintoleranzen DIN EN ISO 2768-m."),
    P("Gezeichnet: J. Eickhoff   Geprüft: S. Wiethoff   Freigegeben: F. Selkinghaus"),
    GAP,
    P("Achtung: Diese Zeichnung ist Eigentum der Wittenbrink Antriebstechnik GmbH und unterliegt der Geheimhaltungsvereinbarung vom 03.02.2019."),
  ],

  "rahmenvertrag-rehwinkel": [
    H1("Rahmenliefervertrag"),
    P("zwischen Selkinghaus Federn- und Stanztechnik GmbH & Co. KG (Besteller)"),
    P("und Rehwinkel GmbH (Lieferant)"),
    GAP,
    H2("§ 1 Vertragsgegenstand"),
    P("Der Lieferant liefert Federstahldraht nach DIN EN 10270-1 in den Güten SH und DH."),
    H2("§ 2 Laufzeit"),
    P("Der Vertrag beginnt am 01.01.2024 und läuft bis zum 31.12.2026. Er verlängert sich um jeweils ein Jahr, sofern er nicht mit einer Frist von drei Monaten gekündigt wird."),
    H2("§ 3 Preise"),
    P("Die Preise werden quartalsweise an den Notierungspreis für Walzdraht angepasst. Basispreis: 1.480,00 EUR je Tonne, Stand 01.01.2024."),
    H2("§ 4 Qualität"),
    P("Jede Lieferung ist mit einem Werkszeugnis 3.1 nach DIN EN 10204 zu begleiten."),
    H2("§ 5 Gerichtsstand"),
    P("Gerichtsstand ist Iserlohn."),
  ],

  "avv-datev": [
    H1("Vertrag zur Auftragsverarbeitung"),
    P("nach Art. 28 DSGVO"),
    GAP,
    P("Verantwortlicher: Selkinghaus Federn- und Stanztechnik GmbH & Co. KG"),
    P("Auftragsverarbeiter: Steuerberatungskanzlei Kortmann, Iserlohn"),
    GAP,
    H2("1 Gegenstand"),
    P("Der Auftragsverarbeiter erstellt die Lohn- und Finanzbuchhaltung. Die Verarbeitung erfolgt über die DATEV-Rechenzentren."),
    H2("2 Datenkategorien"),
    P("Stammdaten, Entgeltdaten, Bankverbindung, Sozialversicherungsnummern der Beschäftigten."),
    H2("3 Technische und organisatorische Maßnahmen"),
    P("Die Maßnahmen des Auftragsverarbeiters ergeben sich aus Anlage 1. Der Verantwortliche hat sich vor Beginn der Verarbeitung von deren Einhaltung überzeugt."),
    H2("4 Unterauftragsverhältnisse"),
    P("Der Einsatz der DATEV eG als Unterauftragsverarbeiter ist genehmigt."),
    H2("5 Löschung"),
    P("Nach Beendigung des Auftrags werden die Daten gelöscht, soweit keine gesetzlichen Aufbewahrungspflichten entgegenstehen."),
    GAP,
    P("Iserlohn, 14.03.2023"),
  ],

  "zertifikat-iso9001": [
    H1("Zertifikat"),
    GAP,
    P("Die Zertifizierungsstelle bescheinigt hiermit, dass das Unternehmen"),
    GAP,
    P("Selkinghaus Federn- und Stanztechnik GmbH & Co. KG"),
    P("Im Hagen 14, 58640 Iserlohn-Sümmern"),
    GAP,
    P("für den Geltungsbereich"),
    P("Entwicklung und Fertigung von Federn, Stanz- und Drahtbiegeteilen"),
    GAP,
    P("ein Qualitätsmanagementsystem eingeführt hat und anwendet, das den Forderungen der folgenden Norm entspricht:"),
    GAP,
    P("DIN EN ISO 9001:2015"),
    GAP,
    P("Zertifikatsregister-Nr.: 20-QMS-4417"),
    P("Gültig vom 01.09.2025 bis 31.08.2028"),
    P("Erstzertifizierung: 1998"),
  ],

  "bestellung-44120": [
    H1("Bestellung 44120"),
    P("Selkinghaus Federn- und Stanztechnik GmbH & Co. KG"),
    P("Datum: 24.03.2025"),
    GAP,
    P("An: Rehwinkel GmbH"),
    GAP,
    TABLE([
      ["Pos", "Artikel", "Menge", "Preis/t", "Wert"],
      ["1", "Federstahldraht SH, 2,50 mm, DIN EN 10270-1", "1.200 kg", "1.512,00 EUR", "1.814,40 EUR"],
    ]),
    GAP,
    P("Liefertermin: KW 14/2025."),
    P("Werkszeugnis 3.1 nach DIN EN 10204 ist beizulegen."),
    P("Es gilt der Rahmenliefervertrag vom 01.01.2024."),
    GAP,
    P("i.A. T. Schauerte, Einkauf"),
  ],

  "jahresabschluss-2024": [
    H1("Jahresabschluss 2024 — Auszug"),
    P("Selkinghaus Federn- und Stanztechnik GmbH & Co. KG"),
    P("Aufgestellt durch Steuerberatungskanzlei Kortmann, Iserlohn"),
    GAP,
    H2("Gewinn- und Verlustrechnung (verkürzt)"),
    TABLE([
      ["Position", "2024", "2023"],
      ["Umsatzerlöse", "24.180.412 EUR", "23.104.877 EUR"],
      ["Materialaufwand", "13.905.210 EUR", "13.001.442 EUR"],
      ["Personalaufwand", "7.412.883 EUR", "7.128.014 EUR"],
      ["Abschreibungen", "1.104.220 EUR", "1.087.902 EUR"],
      ["Jahresüberschuss", "612.404 EUR", "588.311 EUR"],
    ]),
    GAP,
    H2("Anhang, Auszug"),
    P("Auf einen Kunden entfallen 28 % der Umsatzerlöse. Der Verlust dieses Kunden hätte wesentliche Auswirkungen auf die Ertragslage."),
    P("Die Gesellschaft beschäftigte im Jahresdurchschnitt 142 Arbeitnehmer."),
  ],

  "betriebsanweisung-kugelstrahl": [
    H1("BA-07 Betriebsanweisung Kugelstrahlanlage"),
    P("nach § 14 GefStoffV / DGUV Vorschrift 1"),
    P("Stand: 06.03.2024"),
    GAP,
    H2("1 Gefahren für Mensch und Umwelt"),
    P("Strahlmittelstaub. Gehörschädigender Lärm über 85 dB(A). Verletzungsgefahr durch austretendes Strahlmittel bei geöffneter Kabine."),
    H2("2 Schutzmaßnahmen"),
    P("Gehörschutz und Schutzbrille sind zwingend zu tragen. Die Kabine darf nur bei Stillstand und abgeschalteter Strahlmittelförderung geöffnet werden. Absaugung vor Arbeitsbeginn auf Funktion prüfen."),
    H2("3 Verhalten bei Störungen"),
    P("Anlage über den Not-Aus stillsetzen. Instandhaltung verständigen. Störung im Wartungsbuch eintragen."),
    H2("4 Erste Hilfe"),
    P("Bei Augenverletzung sofort mit Augendusche spülen und Durchgangsarzt aufsuchen. Ersthelfer: siehe Aushang."),
    GAP,
    P("Unterschrift Vorgesetzter: ______________________"),
  ],

  /* ---- The three scans. build.sh rasterises these; no text layer survives. ---- */

  // The countersigned copy of a contract that also exists born-digital. A plant has both,
  // and only one of the two can be read by a machine.
  "scan-rahmenvertrag": [
    H1("Rahmenliefervertrag"),
    P("zwischen Selkinghaus Federn- und Stanztechnik GmbH & Co. KG (Besteller)"),
    P("und Rehwinkel GmbH (Lieferant)"),
    GAP,
    P("Basispreis: 1.480,00 EUR je Tonne, Stand 01.01.2024. Quartalsweise Anpassung nach § 3."),
    P("Laufzeit bis 31.12.2026."),
    GAP,
    P("Iserlohn, 08.01.2024"),
    GAP,
    P("_______________________          _______________________"),
    P("T. Schauerte, Einkauf            i.V. Rehwinkel GmbH"),
  ],

  "scan-lieferschein": [
    H1("Lieferschein 44120"),
    P("Rehwinkel GmbH, Altena"),
    P("An: Selkinghaus Federn- und Stanztechnik GmbH & Co. KG, Iserlohn-Sümmern"),
    GAP,
    P("Zu Bestellung 44120 vom 24.03.2025"),
    P("Federstahldraht SH 2,5 mm, 1.200 kg"),
    P("Abgerechnet zu 1.512,00 EUR je Tonne."),
    P("Werkszeugnis 3.1 nach DIN EN 10204 liegt bei."),
    GAP,
    P("Ware angenommen am 02.04.2025, Wareneingang"),
  ],

  /**
   * The employer's copy of a German sick note carries no diagnosis — by law it never does.
   * It is health data under Art. 9 DSGVO all the same: the fact of incapacity and its
   * duration.
   *
   * This page becomes pixels. No text in the corpus states what is inside it, and the
   * filename says only "Scan_0003". That is the point, and it is why mail:0007 exists.
   */
  "scan-au-bescheinigung": [
    H1("Arbeitsunfähigkeitsbescheinigung"),
    P("Ausfertigung zur Vorlage beim Arbeitgeber"),
    GAP,
    P("Krankenkasse: AOK NORDWEST"),
    P("Name, Vorname des Versicherten: Bönnemann, Kai"),
    P("geboren am: 14.09.1991"),
    GAP,
    P("Erstbescheinigung"),
    P("arbeitsunfähig seit: 09.03.2026"),
    P("voraussichtlich arbeitsunfähig bis einschließlich: 20.03.2026"),
    GAP,
    P("Auf der Ausfertigung für den Arbeitgeber wird keine Diagnose angegeben."),
    GAP,
    P("Iserlohn, 11.03.2026"),
    P("Gemeinschaftspraxis Dr. med. R. Hövelmann / Dr. med. B. Schulte-Eickholt"),
    P("Unterschrift und Stempel der Ärztin / des Arztes"),
  ],
};

/* -------------------------------------------------------------------------- */
/* Spreadsheets (-> .xlsx)                                                     */
/* -------------------------------------------------------------------------- */

export const SPREADSHEETS: Readonly<Record<string, readonly Sheet[]>> = {
  /**
   * The crown jewel. The visible sheet shows a price; the factor that produces it lives on
   * a hidden sheet, and only Plaßmann knows it is there. Referenced by his farewell mail.
   */
  kalkulation: [
    {
      name: "Kalkulation",
      rows: [
        ["Artikelnr", "Bezeichnung", "Material EUR/kg", "Rüstzeit min", "Laufzeit s/Stk", "Selbstkosten", "Angebotspreis"],
        [HERO_ARTICLE.articleNo, "Druckfeder 12x40 DH", 2.94, 45, 0.82, 0.98, HERO_ARTICLE.listPriceEur],
        ["SB-44210-DH", "Stanzbiegeteil 20x60", 3.12, 90, 1.44, 1.76, 2.31],
        ["DF-08025-SH", "Druckfeder 8x25 SH", 2.94, 30, 0.61, 0.57, 0.74],
        ["", "", "", "", "", "", ""],
        ["Hinweis:", "Spalte Angebotspreis rechnet mit dem Zuschlag aus dem Blatt 'Zuschlag'.", "", "", "", "", ""],
      ],
    },
    {
      name: "Stammdaten",
      rows: [
        ["Werkstoff", "Preis EUR/kg", "Lieferant", "Stand"],
        ["Federstahldraht DH", 2.94, "Rehwinkel GmbH", "01.01.2026"],
        ["Federstahldraht SH", 2.88, "Rehwinkel GmbH", "01.01.2026"],
        ["Bandstahl DC01", 3.12, "Ostermeier GmbH", "01.01.2026"],
        ["CuSn6", 9.40, "Brammert KG", "01.01.2026"],
      ],
    },
    {
      // table:display="false" -> sheetState="hidden" in the .xlsx.
      name: "Zuschlag",
      hidden: true,
      rows: [
        ["Zuschlagsatz", "Faktor", "Bemerkung"],
        ["Rüstzeit", ZUSCHLAG_RUESTZEIT, "seit 2006 unverändert"],
        ["Gemeinkosten", 1.28, ""],
        ["Verwaltung/Vertrieb", 1.09, ""],
        ["", "", ""],
        ["Angelegt K.-H. Plaßmann, 2006. Bitte nicht ändern.", "", ""],
      ],
    },
  ],

  "preisliste-2026": [
    {
      name: "Preisliste 2026",
      rows: [
        ["Artikelnr", "Bezeichnung", "Werkstoff", "Listenpreis EUR", "gültig ab"],
        [HERO_ARTICLE.articleNo, HERO_ARTICLE.name, HERO_ARTICLE.material, HERO_ARTICLE.listPriceEur, "01.01.2026"],
        ["DF-08025-SH", "Druckfeder 8x25, SH", "SH (DIN EN 10270-1)", 0.74, "01.01.2026"],
        ["SB-44210-DH", "Stanzbiegeteil 20x60", "DC01 (1.0330)", 2.31, "01.01.2026"],
        ["KF-15092-SH", "Kontaktfeder 15x92", "CuSn6 (2.1020)", 3.16, "01.01.2026"],
        ["", "", "", "", ""],
        ["Kundenindividuelle Preise sind im ERP hinterlegt und gehen der Liste vor.", "", "", "", ""],
      ],
    },
  ],

  werkzeugliste: [
    {
      name: "Werkzeuge",
      rows: [
        ["Werkzeugnr", "Artikel", "Bauart", "Standzeit Soll (Hub)", "Lagerplatz"],
        [DISPUTED_TOOL_NO, "SB-44210-DH", "Folgeverbundwerkzeug, 4-fach", DISPUTED_TOOL_LIFE_MASTERCARD, "Regal B7"],
        ["W-4472", "SB-44211-DH", "Folgeverbundwerkzeug, 2-fach", 180000, "Regal B8"],
        ["W-4473", "KF-15092-SH", "Stanzwerkzeug, 1-fach", 320000, "Regal C2"],
        ["W-4474", "SB-44215-SM", "Biegevorrichtung", 90000, "Regal A1"],
        ["", "", "", "", ""],
        ["Quelle: Werkzeugstammkarten. Ist-Standzeiten siehe Wartungsprotokolle.", "", "", "", ""],
      ],
    },
  ],

  maschinenliste: [
    {
      name: "Maschinen",
      rows: [
        ["Inventarnr", "Typ", "Halle", "Aufgestellt", "Seriennummer"],
        ["INV-1212", "Exzenterpresse", "Halle 1", "12.05.2004", "SN-448120"],
        ["INV-1213", "Stanzautomat", "Halle 3", "08.11.2011", "SN-771904"],
        // M-014. The serial number was never recorded — anywhere. Question f08 hangs on it.
        ["INV-1214", "Federwindeautomat", "Halle 2", "22.09.1999", ""],
        ["INV-1215", "Drahtbiegeautomat", "Halle 2", "03.03.2016", "SN-330417"],
        ["INV-1216", "Kugelstrahlanlage", "Halle 3", "17.07.2008", "SN-119288"],
        ["", "", "", "", ""],
        ["INV-1214: Typenschild bei der Aufstellung überstrichen. Nummer bis heute nicht ermittelt.", "", "", "", ""],
      ],
    },
  ],

  pruefmittel: [
    {
      name: "Prüfmittel",
      rows: [
        ["Prüfmittelnr", "Bezeichnung", "Standort", "Letzte Kalibrierung", "Nächste Kalibrierung"],
        ["PM-001", "Messschieber 0-150 mm", "QS-Labor", "14.03.2025", "14.03.2026"],
        ["PM-002", "Bügelmessschraube 0-25 mm", "QS-Labor", "14.03.2025", "14.03.2026"],
        ["PM-004", "Federprüfmaschine FP-1", "QS-Labor", "02.09.2024", "02.09.2025"],
        ["PM-007", "Messmaschine MM-02", "QS-Labor", "11.11.2025", "11.11.2026"],
        ["PM-011", "Schichtdickenmessgerät", "Wareneingang", "20.01.2024", "20.01.2025"],
        ["", "", "", "", ""],
        ["PM-004 und PM-011 sind überfällig. Gemeldet an QMB am 03.02.2026.", "", "", "", ""],
      ],
    },
  ],

  "urlaubsplanung-2026": [
    {
      name: "Urlaubsplanung 2026",
      rows: [
        ["Personalnr", "Name", "Abteilung", "Resturlaub 2025", "Anspruch 2026", "geplant"],
        ["0003", "Hüttemann, Marco", "vertrieb", 4, 30, 22],
        ["0004", "Plaßmann, Karl-Heinz", "werkzeugbau", 11, 30, 30],
        ["0005", "Wiethoff, Sabine", "qs", 2, 30, 25],
        ["0009", "Stracke, Norbert", "fertigung", 0, 30, 28],
        ["0011", "Kalthoff, Uwe", "werkzeugbau", 6, 30, 20],
        ["", "", "", "", "", ""],
        ["Betriebsferien: 20.07. bis 07.08.2026 (drei Wochen).", "", "", "", "", ""],
      ],
    },
  ],
};
