# Contributing to minimal-harness

Thanks for taking the time to contribute. This project is deliberately small —
the guiding rule is **"the best part is no part"** — so the bar for *adding* code,
dependencies, or options is high, and the bar for *removing* them is low.

## Prerequisites

- **Node ≥ 22.5** (the built-in `node:sqlite` used by `SqliteMemory` and
  `SqliteKnowledgeStore` needs it; it is unflagged from Node 23.4).
- No cloud accounts, API keys, or databases. For the runnable examples you need a
  local [Ollama](https://ollama.com) instance — the test suite does **not**.

## Getting started

```bash
git clone https://github.com/mick-gsk/minimal-harness.git
cd minimal-harness
npm install

npm run typecheck   # tsc, strict
npm run lint        # eslint
npm test            # jest, mock LLM adapter — no Ollama required
npm run build       # tsup → dist/
```

## Before you open a PR

Run the full local gate — CI runs exactly these:

```bash
npm run typecheck && npm run lint && npm run build && npm test
```

## Ground rules

1. **Zero runtime dependencies.** `dependencies: {}` is the target state. Prefer a
   Node built-in (`node:http`, `node:crypto`, `node:sqlite`, …) over a package.
   A new dependency needs an explicit, written justification in the PR.
2. **Delete before you add.** Question the requirement, delete, simplify — *then*
   build. Every new constant, option, or file needs a documented "why".
3. **ESM, strict TypeScript.** Relative imports carry the `.js` extension (even in
   `.ts` files). `strict`, `noUncheckedIndexedAccess`, and
   `exactOptionalPropertyTypes` are on and stay on.
4. **Independently testable modules.** New behavior ships with a deterministic test.
   The suite must stay green without a running model.
5. **Language convention.** Code, identifiers, and comments in **English**; internal
   prose docs and specs may be in **German**. Public-facing docs (README, this file)
   are English.
6. **Never tune the harness against the frozen benchmark suite.** Use the dev suite
   (`BENCH_SUITE=dev`) for iteration; changes to the frozen suite happen only via a
   version bump. See [`CLAUDE.md`](CLAUDE.md) for the full engineering principles.

## Commit messages

[Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`,
`docs:`, `test:`, `refactor:`, `chore:`, optionally scoped, e.g.
`feat(server): add per-user rate limit`.

## Scope

The one-sentence thesis this project defends: *a minimal harness beats naive
tool-calling on local models — measured deterministically.* Contributions that
serve that thesis are welcome; anything that doesn't is a candidate for deletion.
