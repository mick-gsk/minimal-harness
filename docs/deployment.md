# Deployment-Guide — minimal-harness Agent-Server

Der Server ist bewusst schlank: ein Node-Prozess, eine SQLite-Datei, Ollama als
Modell-Backend. TLS, Rate-Limiting und externe Erreichbarkeit gehören in einen
Reverse-Proxy davor (nginx/Caddy/Traefik) — nicht in den Agenten.

## Docker (empfohlen)

```bash
docker build -t minimal-harness .
docker run -d --name agent \
  -p 127.0.0.1:8790:8790 \
  -v agent-data:/data \
  -e API_KEYS="sk-CHANGE-ME:alice" \
  -e OLLAMA_BASE_URL="http://host.docker.internal:11434" \
  -e OLLAMA_MODEL="qwen3:8b" \
  minimal-harness
curl http://127.0.0.1:8790/healthz
```

### docker-compose mit Ollama

```yaml
services:
  ollama:
    image: ollama/ollama
    volumes: ["ollama:/root/.ollama"]
    # GPU: siehe Ollama-Doku (deploy.resources.reservations.devices)
  agent:
    build: .
    depends_on: [ollama]
    ports: ["127.0.0.1:8790:8790"]
    volumes: ["agent-data:/data"]
    environment:
      API_KEYS: "sk-CHANGE-ME:alice,sk-OTHER:bob"
      OLLAMA_BASE_URL: "http://ollama:11434"
      OLLAMA_MODEL: "qwen3:8b"
      KNOWLEDGE_DB: "/data/knowledge.db"   # optional: aktiviert knowledge.search
      REQUIRE_APPROVAL: "erp.book"          # optional: Human-in-the-Loop
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://localhost:8790/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 30s
volumes:
  ollama:
  agent-data:
```

Modelle einmalig laden: `docker compose exec ollama ollama pull qwen3:8b`
(plus `snowflake-arctic-embed2`, wenn `KNOWLEDGE_DB` gesetzt ist).

## Umgebungsvariablen

| Variable | Pflicht | Default | Bedeutung |
|---|---|---|---|
| `API_KEYS` | ja | — | `key:userId`-Paare, kommagetrennt; userId scopet alle Sessions |
| `PORT` | nein | 8790 | HTTP-Port |
| `OLLAMA_BASE_URL` | nein | http://localhost:11434 | Modell-Backend |
| `OLLAMA_MODEL` | nein | qwen3:8b | Chat-Modell |
| `MEMORY_DB` | nein | ./agent-memory.db | SQLite-Datei der Sessions (Volume!) |
| `KNOWLEDGE_DB` | nein | — | aktiviert das RAG-Tool `knowledge.search` |
| `EMBED_MODEL` | nein | snowflake-arctic-embed2 | Embedding-Modell (multilingual & stabil, s. Validierung) |
| `REQUIRE_APPROVAL` | nein | — | Tools mit Human-in-the-Loop-Freigabe |
| `SYSTEM_INSTRUCTION` | nein | — | eigener System-Prompt |
| `AUDIT_DB` | nein | — | SQLite-Datei; aktiviert das revisionssichere Audit-Log (Art. 12/19) |
| `AI_DISCLOSURE` | nein | `true` | KI-Kennzeichnung der Antworten (Art. 50); `false` deaktiviert sie |
| `TOOL_POLICY` | nein | — | Tool-RBAC (NIS2/Art. 32): Pfad zu einer JSON-Datei (empfohlen) **oder** inline JSON `{roles, userRoles}`; ohne Angabe darf jeder User jedes Tool |

## Hardware-Planung (VRAM)

Chat- und Embedding-Modell teilen sich die GPU. Faustregel: 8B-Chat-Modell
(q4) ≈ 10–11 GB + Embedding-Modell ≈ 1,2 GB — auf einer 12-GB-Karte wird es eng und
Ollama evictet Modelle im Wechsel (sichtbar als sporadische 500er beim
Embedding unter Last). Für den Mischbetrieb Chat+RAG: 16 GB einplanen oder
`OLLAMA_CONTEXT_LENGTH` reduzieren (Kontext ist der größte VRAM-Hebel).

Gemessen (16-GB-Karte): `qwen3:14b` mit 16k Kontext und `OLLAMA_NUM_PARALLEL=4`
braucht 20,6 GB → 24 % laufen auf der CPU, ~6× langsamer. Für 14B-Recherche-
Agenten entweder ≥24 GB VRAM einplanen oder `OLLAMA_NUM_PARALLEL=1` setzen
(der KV-Cache skaliert mit den parallelen Slots).

**`OLLAMA_CONTEXT_LENGTH` gehört in die Dienst-Konfiguration, nicht in eine
Shell-Session.** Nach einem Ollama-Neustart ohne dieses Setting lädt qwen3 mit
seinem Modell-Default von 40.960 Tokens: gemessen 30,6 GB Bedarf auf der
16-GB-Karte → 49 % CPU-Spill → GPU ~8 % ausgelastet, Läufe 5–10× langsamer.
Der Harness-eigene `numCtx` (pro Request) schützt nur direkte Ollama-Clients;
alles, was über die OpenAI-kompatible `/v1`-API kommt, erbt den Server-Default.

## Betrieb

- **Monitoring:** `GET /metrics` (Prometheus) — Requests, Laufzeiten,
  Terminierungsgründe, Tool-Calls. `GET /healthz` für Liveness.
- **Logs:** eine JSON-Zeile pro Run auf stdout (Metadaten, nie Nachrichteninhalte)
  — direkt konsumierbar von Loki/ELK/journald.
- **Backup:** die SQLite-Dateien in `/data` sichern (WAL-Modus; konsistent per
  `sqlite3 agent-memory.db ".backup ..."` oder Volume-Snapshot bei gestopptem
  Container).
- **DSGVO:** Auskunft über `GET /v1/sessions/{id}`, Löschung über
  `DELETE /v1/sessions/{id}` — pro User nur die eigenen Sessions.
- **Audit-Log (AI Act Art. 12/19/26(6), NIS2):** Mit gesetztem `AUDIT_DB` wird
  jeder Run hash-verkettet und append-only protokolliert (`run_start`,
  `tool_call`, `tool_result`, `approval`, `final_answer`, `run_end`). Jede Zeile
  trägt den Hash der Vorgängerzeile — Manipulation oder Löschung bricht die Kette
  nachweisbar. `GET /v1/audit/verify` (authentifiziert) prüft die Integrität und
  liefert `{ok, brokenAtSeq?, events}`. Große `tool_result`-Payloads werden mit
  Kürzungsvermerk gekappt. **Retention:** Standard-Untergrenze 186 Tage
  (Art. 26(6): mind. 6 Monate); `pruneOlderThan(days)` löscht nur ein
  zusammenhängendes Präfix und speichert einen Checkpoint-Hash, sodass
  `verifyChain` ab dem Löschpunkt lückenlos weiterprüft. Die `AUDIT_DB`-Datei wie
  die übrigen SQLite-Dateien in `/data` sichern.
- **KI-Kennzeichnung (AI Act Art. 50, Pflicht ab 08/2026):** Standardmäßig aktiv
  (`AI_DISCLOSURE=false` deaktiviert). Jede Antwort trägt `aiGenerated: true` im
  JSON-Body plus Header `X-AI-Generated: true`; der erste Turn einer Session
  enthält zusätzlich ein menschenlesbares `disclosure`-Feld. Der Hinweis steht
  nur in den Response-Metadaten, nie im Antworttext des Modells.
- **Tool-RBAC (NIS2 (7), DSGVO Art. 32, AI Act Art. 26):** `TOOL_POLICY`
  aktiviert eine Rollen→Tool-Berechtigungsmatrix. Format (Datei **oder** inline):
  ```json
  { "roles":     { "analyst": ["*"], "buchhaltung": ["erp.*", "fs.read"] },
    "userRoles": { "alice": "analyst", "bob": "buchhaltung" } }
  ```
  Muster: `*` (alle Tools), Präfix `fs.*`, oder exakter Name. Die Durchsetzung
  ist ein **Filter vor dem Loop** — jeder User bekommt nur die erlaubten Tools in
  seine ToolBridge, das Modell sieht verbotene Tools also gar nicht erst (kein
  Prompt-Lärm, keine Umgehung zur Laufzeit). Ein **unbekannter User** (nicht in
  `userRoles`) erhält **least privilege — keine Tools** (fail-closed). Bevorzuge
  die **Datei-Variante** (`TOOL_POLICY=/etc/harness/policy.json`): kein
  Shell-Escaping, versionierbar, als Secret/Volume mountbar. Bei aktivem
  Audit-Log wird beim `run_start` die effektive Rolle + gewährte Toolliste des
  Users protokolliert (Rechenschaft, Art. 5(2)).
- **VVT-Auszug (DSGVO Art. 30):** `GET /v1/compliance/vvt` (authentifiziert)
  erzeugt aus den registrierten Tools + ihren `manifest`-Metadaten einen
  Verzeichnis-Baustein: pro Tool `{name, purpose, dataCategories, recipients,
  rbacRoles, auditRetentionDays}`. Tools ohne Manifest erscheinen mit
  `purpose: "(nicht deklariert)"` — der Report macht die Doku-Lücke sichtbar,
  statt sie zu verbergen.
- **Reverse-Proxy:** TLS-Terminierung + Rate-Limit davor; den Agenten-Port nur
  auf localhost/internem Netz binden (Beispiele oben binden 127.0.0.1).

## systemd (ohne Docker)

```ini
[Unit]
Description=minimal-harness agent server
After=network.target ollama.service

[Service]
Environment=API_KEYS=sk-CHANGE-ME:alice
Environment=MEMORY_DB=/var/lib/minimal-harness/agent-memory.db
ExecStart=/usr/bin/node /opt/minimal-harness/dist/server-main.js
Restart=on-failure
User=harness
StateDirectory=minimal-harness

[Install]
WantedBy=multi-user.target
```
