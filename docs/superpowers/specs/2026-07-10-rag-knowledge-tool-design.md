# Lokales RAG-Tool (Wissensdatenbank) — Design

**Teilprojekt 6d der Mittelstands-Roadmap.** Marktbezug: „KI-gestützte
Wissensverwaltung" ist laut Bitkom 2026 eines der drei am schnellsten wachsenden
Felder; interne Wissensdatenbanken sind ein Standard-KMU-Use-Case. Vollständig
lokal: Embeddings via Ollama, Speicherung in SQLite — null neue Dependencies.

## Komponenten

- **`src/rag/embedder.ts`** — `Embedder`-Interface (`embed(texts) → number[][]`)
  + `OllamaEmbedder` (`POST /api/embed`, Default-Modell `nomic-embed-text`).
  Interface statt Direktkopplung, damit Tests deterministisch bleiben und
  andere Backends (OpenAI-kompatibles `/v1/embeddings`) nachrüstbar sind.
- **`src/rag/knowledge-store.ts`** — `SqliteKnowledgeStore`:
  Tabelle `chunks(id, source, content, embedding BLOB)` (Float32-Buffer).
  `add(source, texts)` embeddet und speichert; `search(query, k)` embeddet die
  Query und rankt per **Brute-Force-Cosine** über alle Chunks.
  Bewusste Entscheidung: kein Vektor-Index — bei KMU-Wissensbasen (Tausende
  Chunks) ist Brute-Force in Millisekunden fertig und null zusätzliche
  Komplexität; ein Index wäre vorzeitige Optimierung.
- **`src/tools/builtins/knowledge.ts`** — Factory `makeKnowledgeSearchTool(store, {topK})`
  → Tool `knowledge.search` (`{query}` → `{results: [{source, content, score}]}`).
  Factory statt statischem Tool, weil das Tool eine Store-Instanz braucht.

Chunking bleibt beim Aufrufer (Dokumente sind kundenspezifisch); das Beispiel
zeigt satzweises Chunking.

## Validierung

1. **Jest (deterministischer Mock-Embedder):** Cosine-Ranking korrekt
   (bekannte Vektoren → bekannte Reihenfolge), Persistenz über Reopen,
   Tool liefert top-k mit Quelle, leerer Store → leeres Ergebnis,
   Batch-Insert transaktional.
2. **GPU-Probe (`bench/rag-probe.ts`):** ~8 firmenartige Kurzdokumente,
   5 Queries mit bekanntem Zieldokument, echtes `nomic-embed-text` —
   gemessen werden **hit@1** und **hit@3**.
