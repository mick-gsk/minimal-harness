# Company-Probe: Produktionsreife-Test am Demo-Unternehmen

Misst, ob das Harness als interner Wissensassistent eines (synthetischen)
Mittelständlers funktioniert — und ob es **bestehende Lösungen schlägt**.
16 Ground-Truth-Fragen (`company/truth/facts.jsonl`) über vier Datensysteme:
Fileserver (teils windows-1252), Mail-Archiv, AD-Exporte, ERP (SQLite).

**Probe, kein Benchmark:** schreibt nie `BENCHMARKS.md`. `company/out/truth/`
wird niemals indiziert oder dem Agenten zugänglich gemacht.

## Arme (`COMPANY_HARNESS`)

| Arm | Was er misst |
|---|---|
| `minimal` (Default) | das Harness mit Text-Protokoll (ACTION/TOOL/ARGS) |
| `minimal@nt` | das Harness mit `nativeToolCalling` (Tool-Specs über die API) |
| `minimal@nt4` | wie @nt, plus Recherche-Policy: 4 parallele Tool-Calls/Turn |
| `native` | naives Ollama-Function-Calling ohne Harness (faire Baseline) |
| `smolagents-code` | Hugging Face CodeAgent, off-the-shelf (HF-Empfehlung) |
| `smolagents-tool` | Hugging Face ToolCallingAgent, off-the-shelf |

Alle Arme bekommen dieselbe Deployment-Instruktion, dieselben vier Tools
(`fs.list`, `fs.read`, `fs.search`, `erp.query`), dasselbe Turn-Budget (12),
temp 0.1, Seeds 1001–1003, 16k Kontext.

## Läufe & Auswertung

```bash
OLLAMA_BASE_URL=http://127.0.0.1:21434 OLLAMA_MODEL=qwen3:8b \
  npx tsx bench/company/probe.ts            # Live-Score auf stdout

npx tsx bench/company/rescore.ts            # Offline-Re-Score über results.jsonl
```

- Jeder Lauf hängt `{model, harness, think, seed, factId, ok, answer, raw}`
  an `results.jsonl` (volle Antworten = Evidenz; `raw` = letzter Roh-Output
  bei abnormaler Terminierung).
- `rescore.ts` wertet die **aktuellen** Checks aus `facts.ts` über alle
  persistierten Antworten neu aus (last-wins-Dedupe) — Check-Kalibrierung
  kostet nie wieder GPU-Stunden.
- Checks sind deterministisch (kein LLM-Judge); `REFUSAL` ist gegen geloggte
  echte Verweigerungsformulierungen kalibriert und gilt für alle Arme gleich.

## Env-Schalter

| Variable | Bedeutung |
|---|---|
| `COMPANY_HARNESS` | Arm, s. o. |
| `COMPANY_SEEDS` | z. B. `1001` für Smoke (Default `1001,1002,1003`) |
| `COMPANY_FACTS` | z. B. `f01,f13` für Smoke (Default: alle 16) |
| `COMPANY_THINK` | `0` für Modelle ohne Thinking (llama3.1) |
| `COMPANY_LOG` | Pfad der JSONL (Default `bench/company/results.jsonl`) |
