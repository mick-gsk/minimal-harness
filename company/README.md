# company/ — a simulated German Mittelstand company

A deterministically generated data artifact: a 142-person spring and stamping supplier in
the Sauerland, with its grown fileserver, its half-migrated ERP, its Active Directory, its
mail archive, its abandoned DocuWare, its machine-data export, its DATEV handover and its
CAD vault — and its mess. **2.169 files, 2,7 MB, generated in two seconds.**

It exists because the harness's claim ("works in a company") had no company to be tested on.

A Mittelständler does not have one system. It has seven, and they disagree with each other.
Every disagreement in this corpus is **computable** — that is the only reason it is here.

## Scale, and where it comes from

No file count was chosen. Every number is derived from the business, and `verify.ts` checks
that the ERP's own invoices add back up to the stated revenue (currently within 2,5 %).

| Derivation | Result |
|---|---|
| 24,18 Mio € revenue ÷ 64.800 € average order | 373 orders/year |
| × 2,52-year window (2024-01-01 → 2026-07-10) | **941 orders** |
| 60 % of orders get an Angebot (the rest are call-offs) | 564 Angebote |
| 40 % (automotive) get a Prüfprotokoll | 386 Prüfprotokolle |
| 2 % complaint rate | 16 8D-Reports |
| 34 machines × 6 maintenance events | 209 Wartungsprotokolle |
| one master card per stamping tool | 184 Werkzeugstammkarten |
| weekly production meeting, monthly BR minutes and shift plans | 197 protocols |
| one personnel file and one leave request per employee | 293 (personal data) |
| the shared mailbox that stands in for a ticket system | 256 mails |
| 12 of 34 machines wired to the BDE × 2 shifts × workdays | 2.424 BDE rows over 5 months |
| Vertrieb and QM, everything filed before the DocuWare rollout stalled | 558 index entries |
| the 2025 invoices, handed to the tax adviser | 387 DATEV bookings |
| one CAD record per article | 380 PDM rows |

**Rechnungen and Lieferscheine are deliberately not files.** They are rows in `erp.sqlite`
(941 invoices, 2.371 delivery notes) — exactly as in a real plant, and it is also what stops
the file count from exploding into meaningless volume.

**This directory touches nothing else in the repo.** No `src/`, no `bench/`, no new runtime
dependency. `dependencies: {}` stays empty; the generator is plain Node.

```bash
npx tsx company/generate.ts    # writes company/out/  (gitignored)
npx tsx company/verify.ts      # 52 integrity + anti-Potemkin checks, exits 1 on failure
npx tsx company/acl-report.ts  # derives the GDPR findings from the exported ACLs
npm run typecheck:company      # strict TS over company/ (own scope; leaves src/ + bench/ alone)
```

Authoring only, and only when a hero document changes — `generate.ts` never calls these:

```bash
npx tsx company/fixtures/author.ts   # hand-written content -> flat ODF XML
bash company/fixtures/build.sh       # LibreOffice -> committed .docx/.xlsx/.pdf
npx tsx company/fixtures/vendor.ts   # fetches the BetrVG snapshot (needs network)
```

## What this artifact can and cannot prove

It carries **two** claims, and explicitly not a third:

- **Uplift** — agent + harness against naive tool-calling over an *identical* corpus.
- **Demo** — a prospect watches an agent work on their kind of data, on their own hardware.
- **Not** *"better than existing solutions."* The same author designed both the documents and
  the questions. That is the home-field objection this repo already concedes for its own
  benchmark suites in [`bench/FAIRNESS.md`](../bench/FAIRNESS.md) §1. The company inherits the
  same honest scope rather than hiding it. Only a real pilot customer closes that gap.

## The rule that makes it work

**The fact model in `model/` is the only source of truth. Every document is a projection of
it, with noise injected. Never the other way round.** That is why each question has a
*computable* answer rather than a hand-written one.

`out/` therefore has two trees, and the separation is load-bearing:

| Tree | Contents | Rule |
|---|---|---|
| `out/corpus/` | `fileserver/`, `mail/`, `erp/`, `ad/`, `dms/`, `bde/`, `datev/`, `pdm/` | This is what an agent may read. |
| `out/truth/` | `world.json`, `manifest.json`, `erp.sql`, `LOGICAL-HASH.txt` | **Never index this.** It restates every fact in plain text. |

Point an ingestion pipeline at `out/corpus/`; grade against `out/truth/` and
`truth/facts.jsonl`. Indexing both would hand the agent the answer key and measure nothing.

## The seven systems

| System | What it is | What it contributes |
|---|---|---|
| `fileserver/` | the grown K:\ drive | the mess, the ACLs, 1.896 files |
| `mail/` | Exchange, `.eml` | the tribal price; the shared mailbox that stands in for a ticket system |
| `erp/` | `erp.sqlite` + a stale 2019 CSV export | invoices, delivery notes, the list price |
| `ad/` | `Get-ADUser` / `icacls` dumps, CP1252 | the raw material for the ACL delta |
| `dms/` | DocuWare, rolled out to two departments and then abandoned | 558 indexed files, **88 of them dangling** |
| `bde/` | machine data, five monthly exports | the works council's § 87 complaint, as data |
| `datev/` | EXTF Buchungsstapel handed to the tax adviser | a cross-system consistency check against the ERP |
| `pdm/` | a CAD index whose files live on a drive nobody exported | the ERP migration's real blocker, countable |

The last four are what makes this a company rather than a document dump. They are the
systems that disagree, and none of them can be checked by reading one file.

## The contradictions

These carry the entire "messy company, agent finds the truth" story. The first four map to
[`truth/facts.jsonl`](truth/facts.jsonl); the systems' contradictions map to
[`truth/system-facts.jsonl`](truth/system-facts.jsonl).

1. **Tribal knowledge** — the price agreed with the main customer (`1,17 EUR/Stück`) exists in
   exactly one `.eml` and nowhere else. The ERP carries the list price, so the customer disputes
   the invoice. `verify.ts` proves by grep that the number occurs once in the whole corpus.
2. **Stale versions** — three revisions of work instruction AA-032 sit in three folders, one of
   them named `_final_final_v3_NEU`. Which one is valid is recorded only in the
   Dokumentenlenkungsliste.
3. **Access control** — `Gehaltsliste_2026.csv` lies in a folder that grants *Domänen-Benutzer*
   read access, and HR can read the works council's minutes. Both findings are **computed** by
   `acl-report.ts` from the exported `ad/acls.csv` against the Verzeichnis von
   Verarbeitungstätigkeiten — not asserted anywhere in the model.
4. **No authority** — the tool master card and the maintenance log disagree about the service
   life of tool W-4471, and neither document is authoritative. The correct answer names the
   contradiction instead of picking a number.

And three that only exist because there is more than one system:

5. **Index rot** — 88 of DocuWare's 558 entries point at files that no longer carry that
   name. Nobody wrote those 88 rows. The mess injector renames bulk documents *after*
   DocuWare recorded their paths, and nobody reconciles the two. `README_Migration.txt` in
   `dms/` says outright that the number is unknown; finding it means joining a CSV export
   against the filesystem.
6. **Processing without a legal basis** — the BDE export gains a `Personalnummer` column in
   `2026-04`, which is exactly what the works council alleges in `mail:0003`. The February
   and March files do not have it, so the allegation is provable from the data. The June file
   still has it, although the works council resolved on 19.05.2026 to suspend the evaluation.
   *That* is in no document at all.
7. **A number from a system that no longer exists** — `mail:0004` puts the articles whose
   drawing-number field holds a tool number at "rund 1.400". The PDM index says 172. The
   IT-Leiter counted rows in the retired Sage export and never said so, because nobody ever
   does. The index is authoritative and only counting settles it.

## The 23 hero documents

A corpus of 2.169 text files would still be a lie — a real Mittelständler's drive is Word,
Excel and PDF. So twenty-three documents are hand-authored and shipped as **real binaries**:
6 × `.docx`, 6 × `.xlsx`, 8 × `.pdf`, and 3 PDFs that are scans, committed under
`fixtures/bin/`.

They are written as flat ODF XML (`fixtures/src/*.fodt`, `*.fods`) — human-readable and
diffable in git — and converted once by LibreOffice. `generate.ts` copies the committed bytes
and never converts, which is why it still needs no LibreOffice and stays deterministic.
`dependencies: {}` remains empty; no devDependency was added either.

Validated, not assumed: every `.docx`/`.xlsx` is a well-formed ZIP, every `.pdf` starts with
`%PDF-`, and `CHECKSUMS.txt` catches an accidental rebuild, because LibreOffice output is not
byte-stable across versions.

### What "has a text layer" actually means

The three scans are rendered to a bitmap and then wrapped in a PDF, so a text extractor gets
nothing from them — which is what it would get from the real thing.

Proving that took correcting a mistake. The obvious test, *"does the PDF embed a `/Font`?"*,
reports a text layer on all three scans: LibreOffice Draw embeds a font resource into a page
that is nothing but pixels. The decisive question is whether a glyph is ever **drawn**, so
`verify.ts` decompresses every content stream and counts `Tj`/`TJ` operators. The eight
born-digital PDFs run 12 to 36 of them. The scans run zero. Both facts are asserted.

The centrepiece is `Vertrieb/Kalkulation/Kalkulation_Angebote.xlsx`. The visible sheet shows a
price. The factor that produces it — `1,7` on the Rüstzeit — sits on a **hidden third sheet**
(`sheetState="hidden"`), and the only person who knows it is there retires on 31.12.2026 and
says so in his farewell mail. That is not a puzzle anyone invented; it is what happens when a
foreman builds the costing sheet in 2006 and nobody asks.

### And the harness cannot read a single one of them

Nothing in `src/` parses a `.docx`, `.xlsx` or `.pdf` today. That is deliberate, and it is the
point: the fixtures make the gap **concrete and measurable** instead of leaving it as a claim.

Eight questions that only a parser can answer live in [`truth/binary-facts.jsonl`](truth/binary-facts.jsonl)
— kept **separate** from `truth/facts.jsonl`, because `bench/company/probe.ts` grades against
that file and adding questions to it mid-measurement would silently move its goalposts.
`verify.ts` pins `facts.jsonl` at exactly 16 facts for that reason.

The six questions in [`truth/system-facts.jsonl`](truth/system-facts.jsonl) are separate for
the same reason, not because they need a parser: they need a **join**. Counting DocuWare's
dangling entries or checking the DATEV stapel against the ERP is plain text work, and it
would belong in `facts.jsonl` — at the next suite version bump, per CLAUDE.md principle 7.
Until then the frozen file stays frozen. `verify.ts` recomputes `s01` (88 dangling) and `s04`
(172 misfiled) from the corpus and fails if the recorded answer has drifted, so the numbers
in that file cannot go stale.

Note how `b07` and `f08` interlock: the maintenance spreadsheet explains *why* machine INV-1214
has no serial number (the type plate was painted over), while the number itself stays
underivable. Reading the Excel does not turn an unanswerable question into an answerable one.

## The finding nobody wrote

The mess injector copies files into `Austausch`, `Scans`, `_ALT` and the folder of the man who
left in 2021. It does not look at what it is copying. Some of those copies are personnel files
and works council minutes, and those folders are writable by every domain user.

Nobody authored that finding. It falls out of *"people copy things"* meeting *"the ACL was last
reviewed in 2021"* — and `acl-report.ts` finds all twelve of them. It is the most realistic
thing in the corpus, which is why `verify.ts` asserts it must keep happening.

```
K:\Betriebsrat\Protokolle  GG_Personal (ReadAndExecute)       31 x special-category
K:\Austausch               Domänen-Benutzer (Modify)           4 x personal-data   <- Kopien
K:\Scans                   Domänen-Benutzer (Modify)           3 x personal-data   <- Kopien
K:\Grothe                  Domänen-Benutzer (ReadAndExecute)   2 x personal-data   <- Kopien
K:\_ALT                    Domänen-Benutzer (ReadAndExecute)   2 x personal-data   <- Kopien
K:\Personal\Gehaelter      Domänen-Benutzer (ReadAndExecute)   1 x personal-data
K:\Scans                   Domänen-Benutzer (Modify)           1 x special-category
```

Note what does *not* appear: `Personal/Personalakten`. That folder is correctly restricted, and
the report must not fire on everything merely because it is sensitive. `verify.ts` asserts that too.

### The last line, and the limit of this artifact

That final row is a scanned sick note. The multifunction printer in the corridor writes to
`K:\Scans`, and `mail:0007` is the mail in which HR asks IT for a separate scan target and is
told the printer can only have one. The file is called `2026-03-11_Scan_0003.pdf`. Its name
reveals nothing, and it has no text layer.

So `acl-report.ts` finds it — through the manifest's classification — and **no agent confined
to the corpus can.** That gap is the honest result, not an oversight. Faking OCR text on the
page would fabricate exactly the entropy this artifact refuses to fabricate. The question
"which file in `K:\Scans` holds health data?" is therefore recorded as *unanswerable*
(`s06`), and an agent that names a file is hallucinating.

## Anti-Potemkin

A generated corpus is a film set unless you build against its tells. `verify.ts` asserts:

- **≥ 2 unanswerable questions** whose correct answer is "not derivable" and which cite no
  source at all. They measure hallucination, not retrieval.
- **≥ 1 contradiction with no authoritative source.**
- **≥ 1000 documents referenced by no question**, and the ground-truth sources stay under 1 %
  of the corpus. A corpus in which every document is relevant is the classic generator tell.
- **A corpus large enough that retrieval is not trivial** (≥ 1500 files). At 41 files, naive
  search finds everything and the harness proves nothing.
- **A confusable distractor firm** — `Selkinghaus Draht- und Umformtechnik GmbH` in Hemer, no
  relation. Entity resolution is not free.
- **Decay**: ≥ 100 files with chaotic human names (`_final_final_v3_NEU`, `Kopie von`, `(2)`),
  ≥ 20 groups of byte-identical duplicates, ≥ 10 files carrying mojibake (`PrÃ¼fung`) from a
  bad conversion during the 2016 server migration.
- **Non-author entropy**: the full text of the **Betriebsverfassungsgesetz**, vendored from
  `gesetze-im-internet.de` (amtliches Werk, gemeinfrei nach § 5 Abs. 1 UrhG). It is the one
  file here nobody on this project wrote. Real legal German — nested subsection numbering,
  *"im Sinne des Absatzes 2 Satz 3"* — is prose no generator imitates, and without it a
  retriever that has learned this author's cadence would be measuring itself. It is also not
  a random statute: § 9 is where `BETRIEBSRAT_SIZE = 7` comes from, and § 87 Abs. 1 Nr. 6 is
  what the works council cites against the BDE evaluation. `verify.ts` checks both passages
  are present verbatim.
- **No document kind that dominates the corpus is a template.**

That last check replaced a broken one, and the story is worth keeping. The old invariant read
"document length CV > 0.5" over *all* fileserver files. Once the 172 KB statute landed, that
coefficient read **6.7** — one outlier carried it, and a corpus of byte-identical documents
would have sailed through. Measured honestly over just the generated text, it read 0.54, and
the per-kind breakdown showed why: 564 Angebote of 569 ± 28 bytes, 386 Prüfprotokolle of
328 ± 23. Every kind was a template; only the *mixture* of kinds varied.

So the offers now quote between zero and five price tiers, the inspection reports measure
between one and six characteristics, and the maintenance logs list the parts they actually
replaced. Within-kind variance went from 0.02–0.07 to 0.16–0.25. The invariant now demands
that any kind holding a tenth of the drive varies in length — which is the property that was
supposed to be asserted all along.

Deliberately *not* faked: OCR noise, handwriting, coffee stains. Generating those would be
fabricated entropy. The three scans really have no text layer, the manifest says
`hasTextLayer: false`, and that is where it stops.

## Determinism

`Math.random`, `Date.now`, bare `new Date()`, and everything under `Intl` (`toLocaleString`,
`localeCompare`) are forbidden in this directory. ICU versions differ between Node builds, so
locale formatting would not be reproducible; German numbers and dates are formatted by hand in
[`lib/fmt.ts`](lib/fmt.ts).

Reproducibility is proven over **logical content**, not container bytes: `node:sqlite` stamps
`SQLITE_VERSION` into the database header, so `erp.sqlite` is never hashed. `truth/erp.sql`
holds a canonical SQL dump instead, and `LOGICAL-HASH.txt` is the SHA-256 of
`world.json` + `erp.sql`. Generating twice yields the same hash.

## Encoding

The 2019 ERP export, the salary list, the document control list, the Active Directory dumps,
the DocuWare index, all five BDE exports, the DATEV Buchungsstapel and the PDM index are
**Windows-1252**, semicolon-separated, decimal comma — the way German systems really write
CSVs. Node's `latin1` is *not* CP1252 (it encodes `€` as `0xAC` instead of `0x80`), so
[`lib/cp1252.ts`](lib/cp1252.ts) does it properly. Mail is UTF-8: the encoding trap belongs
where it is authentic, not everywhere. `generate.ts` and the writer share one `CP1252_KINDS`
set, so the manifest's `encoding` field cannot drift away from the bytes on disk.

The DATEV file additionally shows why a general "German number" formatter is not enough:
DATEV writes `1234,56` with **no** thousands separator, so `deNumber()` would corrupt it.

## Everything is invented

The company, its people, its customers and suppliers do not exist. The name *Selkinghaus* was
checked against the German spring/stamping/wire trade before use. The towns of the Märkischer
Kreis are real; the firms placed in them are not. A copy of this notice sits at the corpus root
as `HINWEIS_SYNTHETISCHE_DATEN.txt`.

## What it cannot simulate

- Whether the harness beats existing solutions in a *real* company. Only a pilot customer knows.
- The real distribution of questions employees actually ask.
- Live system behaviour: AD authentication, Exchange transport, executed ERP business logic,
  runtime permission inheritance. This is a snapshot at a fixed date, not a running plant.
- Binary fidelity of proprietary formats. The CAD files do not exist: `pdm/cad-index.csv`
  points at `M:\CAD`, a drive that was never exported, and `pdm/README_CAD-Ablage.txt` says
  so in the plant's own voice. The metadata sits in the index, never as a sidecar next to the
  file — otherwise the "these are unreadable" claim would be a stage prop.
- Reading the scans. That would need OCR, and inventing OCR output would be fabricated
  entropy. The gap is declared (`hasTextLayer: false`) rather than papered over.
- The infinite long tail of a real K:\ drive. This one is finite and curated.

## Status

Phases 0 (plaintext kernel), 1 (hero fixtures) and 2 (seeded bulk) are complete, plus the
four systems the plan's own `out/corpus/` layout promised and had not delivered: `dms/`,
`bde/`, `datev/`, `pdm/`. The plan's open decisions are settled too: the firm name was
collision-checked, the DSGVO snapshot became the BetrVG (EUR-Lex is a bot wall; the works
council's own statute fits better), and `npm run typecheck:company` puts the generator — the
largest new body of code — under strict TS without touching `src/` or `bench/`.

Phase 3 — a zero-dependency DOCX/XLSX/PDF *writer* — stays **deferred**, and its own
precondition is the reason. The plan says build it only once a binary *reader* exists to
measure it against; none does, nothing in `src/` can open a `.docx`, and this directory does
not touch `src/`. So a hand-rolled OOXML/PDF writer (the hard part is a real `/ToUnicode` text
layer) would be hundreds of lines serving no consumer — CLAUDE.md principles 1, 5 and 6 all
point the same way. LibreOffice already produces valid binaries at no cost to the runtime.
Build it only if a binary reader lands in `src/` *and* the fixtures must be produced on a
machine without LibreOffice.

The obvious next steps are not in this directory:

1. Teach the harness to read the twenty-three documents it cannot open, and grade it against
   `truth/binary-facts.jsonl`.
2. Grade it against `truth/system-facts.jsonl` — those six questions need no parser, only the
   ability to join a CSV against a directory listing and a SQL aggregate. That is the skill a
   Mittelstand agent actually needs, and nothing measures it yet.
