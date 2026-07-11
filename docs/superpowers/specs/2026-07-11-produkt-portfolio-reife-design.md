# Produkt- & Portfolio-Reife — Design

> Status: angenommen · Datum: 2026-07-11 · Autor: Mick G. (mick-gsk)
> Vorgabe: „Verbessere das Repo so, dass es sich als **Produkt** *und* als
> **Portfolio-Projekt** eignet — orientiert an bekannten, aktuellen großen Repos."

## Problem

Die **Substanz** von `minimal-harness` ist bereits auf dem Niveau reifer OSS-Projekte:
zero-dependency (`dependencies: {}`), strikt typisiertes ESM, ~2.750 LOC Kern, 28 Test-Suites,
eine Ablations-Benchmark-Matrix mit 95-%-Wilson-CIs, ein Multi-User-Server, lokales RAG,
persistente SQLite-Memory und ein interaktives Benchmark-Dashboard.

Was fehlt, sind nicht Features, sondern die **Erkennungssignale**, an denen man große Repos
(Hono, Zod, Vitest, Vercel AI SDK) sofort als „Produkt" liest — und etwas **Hygiene**:

| Lücke | Konsequenz |
|---|---|
| Kein `LICENSE` | Rechtlich als Produkt unbenutzbar (Default = „all rights reserved") |
| Keine CI (`.github/workflows` fehlt) | Kein grüner Check, kein automatisches Qualitäts-Gate |
| README ohne Hero/Badges | Zeile 1 nackt `# minimal-harness`, kein Value-Prop-Signal |
| `package.json` nicht publish-fähig | Kein `license`/`repository`/`author`/`files`/`engines` |
| Keine Community-Health-Files | `CONTRIBUTING`/`SECURITY`/`CODE_OF_CONDUCT`/`CHANGELOG` fehlen |
| Uncommitteter Ballast | `.playwright-mcp/`, `*.db-wal`, `light-desktop.png` neben wertvoller Arbeit |

## Leitthese (Scope-Wächter)

> Die Substanz existiert — dieser Pass **verpackt** sie wie ein großes *minimales* Repo.
> Kein Umbau am Kern, keine Runtime-Dependency, keine Doku-Toolchain. „The best part is no part."

Das ist bewusst **Approach A** (Packaging- & Flaggschiff-Pass), nicht B (`npx`-CLI) oder C
(VitePress-Microsite + Logo) — B/C fügen Oberfläche hinzu, die die Zero-Dependency-These
verwässert. Große *minimale* Repos gewinnen über saubere Signale, nicht über Umfang.

## Entscheidungen (vom User bestätigt)

1. **Vertrieb:** npm-Paket **und** GitHub-Showcase → volle Publish-Reife (Metadaten, `files`,
   `prepublishOnly`, einschaltbereiter Release-Workflow). Das eigentliche `npm publish` bleibt
   ein manueller Schritt des Autors.
2. **company/-Demo:** als **Flaggschiff** einbauen und committen (Generator-Quellen, ~84 Dateien /
   ~6.200 LOC; der generierte 13-MB-Korpus unter `company/out/` bleibt ignoriert).
3. **Lizenz:** **MIT** (Standard schlanker TS-Libs; maximale Adoption, passt zur Minimalismus-These).

## Vorbild-Repos (woran wir uns orientieren)

- **Hono** — minimal, zero-dep, Badge-Hero, Benchmark-Tabelle im README.
- **Zod** — Single-Purpose, README-getrieben, MIT, klare „Warum"-Erzählung.
- **Vitest / tRPC / Drizzle** — CI-Matrix, vollständige Health-Files, saubere `package.json`.
- **smolagents** (HuggingFace) — der im Repo bereits referenzierte Kontrahent; minimales Agents-Lib.

## Umfang — 6 Phasen

### Phase 0 — Repo-Hygiene (Voraussetzung)
- `.gitignore` erweitern: `.venv/`, `.playwright-mcp/`, `*.db-shm`, `*.db-wal`, `light-desktop.png`.
  (`company/out/`, `knowledge.db`, `results*.jsonl` sind bereits ignoriert.)
- Streumüll aus dem Working Tree entfernen: `.playwright-mcp/`, `light-desktop.png`,
  `bench/company/*.db-shm|-wal`.
- Zweck: Der spätere company-Commit schleppt keine 13 MB generierten Korpus mit.

### Phase 1 — Rechts- & Produkt-Grundlage
- `LICENSE` — MIT, 2026, Mick G.
- `package.json` publish-fähig: `license: "MIT"`, `author`, `repository`, `homepage`, `bugs`,
  `keywords`, `files: ["dist"]`, `engines: { node: ">=22.5.0" }`, `sideEffects: false`,
  `prepublishOnly: "npm run build && npm test"`, `publishConfig.access: "public"`.
  `dependencies: {}` bleibt unverändert.
- **Begründung `engines`:** `index.ts` re-exportiert `SqliteMemory`/`SqliteKnowledgeStore`;
  beide importieren `node:sqlite` an der Modulwurzel — ein Root-Import scheitert daher auf
  Node < 22.5. `>=22.5.0` ist der ehrliche Floor, nicht bloß advisorisch.

### Phase 2 — CI/CD (der grüne Check)
- `.github/workflows/ci.yml`: Trigger push/PR auf `main`; Node-Matrix `22.x`/`24.x`;
  Schritte `npm ci` → `typecheck` → `lint` → `build` → `test`.
- Tests müssen **ohne Ollama** grün sein (Mock-Adapter). Ollama-/netz-abhängige Tests werden
  per Env-Guard (`OLLAMA_LIVE`/`describe.skip`) übersprungen; in Phase 6 real verifiziert.
- `.github/workflows/release.yml`: **einschaltbereit**, Trigger Tag `v*` → `build` → `npm publish`
  (erfordert `NPM_TOKEN`-Secret). Liefert zusätzlich die Grundlage der CI-Badge.

### Phase 3 — README als Flaggschiff
- Zentrierter **Hero**: Titel + Tagline + Badge-Reihe
  (CI · npm-Version · MIT · TypeScript-strict · **0 dependencies** · Node ≥22.5).
- Über-dem-Falz: 30-Sekunden-Pitch, `npm install minimal-harness`, Minimal-Beispiel.
- **Differenzierer nach oben:** Benchmark-Uplift (Headline-Zahl + Dashboard-Link) und
  „Gegen eine echte Firma bewiesen" (company/).
- Table of Contents. Alle bestehenden Tiefen-Abschnitte bleiben erhalten, nur neu geordnet.

### Phase 4 — Community-Health
- `CONTRIBUTING.md` — Setup, ESM-`.js`-Import-Regel, Deutsch-Prosa/Englisch-Code, Conventional
  Commits, Link auf die Engineering-Prinzipien in `CLAUDE.md`.
- `CODE_OF_CONDUCT.md` — Contributor Covenant 2.1.
- `SECURITY.md` — Meldeweg (GitHub Security Advisories / E-Mail).
- `CHANGELOG.md` — Keep-a-Changelog; `0.1.0` aus der Git-Historie geseedet + `Unreleased`.
- `.github/`: `ISSUE_TEMPLATE/bug_report.md`, `feature_request.md`, `config.yml`,
  `PULL_REQUEST_TEMPLATE.md`.

### Phase 5 — company/ als Flaggschiff-Demo
- Generator-Quellen + `company/README.md` + `bench/company/`-Quellen committfähig machen
  (generierte `*.db*`/`*.jsonl` bleiben ignoriert); `examples/hard-task.ts` dazu.
- README-Abschnitt mit dem stärksten Hook: *`verify.ts` prüft, dass die ERP-Rechnungen sich
  auf 2,5 % genau zum ausgewiesenen Umsatz aufsummieren.*

### Phase 6 — Verifikation (früh echt messen)
- `npm run typecheck && npm run lint && npm run build && npm test` — **real ausführen**, grün.
- `npm pack --dry-run` → Tarball enthält nur `dist/` + `README` + `LICENSE` (+ ggf. `CHANGELOG`).
- Badge-URLs auflösen; `git status` frei von Müll; company-abhängige Tests laufen ohne den
  gitignorierten Korpus (sonst Generator in `beforeAll` oder Test-Gate).

## Nicht-Ziele (YAGNI)

- Keine Runtime-Dependency (`dependencies: {}` ist Zielzustand).
- Keine Docs-Microsite (VitePress/Docusaurus) — Dashboard + README genügen.
- Kein changesets/semantic-release/Husky — manuelles CHANGELOG + Tag-Workflow reichen bei 0.1.0.
- Keine Logo-Grafik — Text-Wordmark + Badges ist der große-Repo-Baseline (vgl. Zod).
- **Kein** Umbau am bestehenden Code; dieser Pass ist Verpackung + Hygiene, kein Refactor.

## Verifikationskriterien (Definition of Done)

- [ ] `LICENSE` (MIT) vorhanden; `package.json` publish-fähig; `npm pack --dry-run` sauber.
- [ ] CI-Workflow vorhanden; `test`/`lint`/`typecheck`/`build` lokal grün ohne Ollama.
- [ ] README mit Hero, Badge-Reihe, TOC, Benchmark- und company-Sektion.
- [ ] `CONTRIBUTING`/`CODE_OF_CONDUCT`/`SECURITY`/`CHANGELOG` + `.github`-Templates vorhanden.
- [ ] company/-Generator committfähig (Korpus ignoriert); README verlinkt.
- [ ] `git status` zeigt nur gewollte Quellen, keinen Ballast.
