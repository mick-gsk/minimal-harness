# BENCHMARKS

> Datum: 2026-07-10 · Suite: **suite-v2** · k=5 Läufe/Task (Seeds: 1001, 1002, 1003, 1004, 1005) · Temperatur: 0.7 · Intervalle: 95 % Wilson. Baseline `naive` ist **illustrativ** (zeigt den Beitrag von Retry/Recovery), Uplift wird gegen `ollama-native` gemessen.

## Modell: `qwen3:8b`

| Harness | Erfolgsrate | 95 %-CI | pass^5 | Ø Tokens | Ø Latenz |
|---|---|---|---|---|---|
| ollama-native | 85.2% (213/250) | [80.3%, 89.1%] | 76.0% | 1413 | 12042 ms |
| naive | 59.2% (148/250) | [53.0%, 65.1%] | 50.0% | 999 | 10392 ms |
| minimal | 90.0% (225/250) | [85.7%, 93.1%] | 74.0% | 2049 | 16522 ms |

Harness-Uplift (minimal vs. ollama-native): +4.8 pp — **kein signifikanter Unterschied** (Konfidenzintervalle überlappen; mehr Tasks/Läufe nötig).

## Modell: `llama3.1`

| Harness | Erfolgsrate | 95 %-CI | pass^5 | Ø Tokens | Ø Latenz |
|---|---|---|---|---|---|
| ollama-native | 56.4% (141/250) | [50.2%, 62.4%] | 52.0% | 468 | 3042 ms |
| naive | 33.6% (84/250) | [28.0%, 39.7%] | 24.0% | 403 | 993 ms |
| minimal | 92.4% (231/250) | [88.4%, 95.1%] | 84.0% | 1075 | 1519 ms |

**Harness-Uplift (minimal vs. ollama-native): +36.0 pp** — signifikant (Konfidenzintervalle disjunkt).

## Geltungsbereich dieser Zahlen

- **Was die Suite trägt:** den **Uplift-Claim** (minimal vs. ollama-native/naive) — alle Arme laufen auf identischen Tasks, Tools, Modellen und Seeds; gemessen wird eine Differenz auf gleichem Terrain.
- **Was sie nicht trägt:** Diese Suite ist vom Autor von minimal-harness entworfen und minimal wurde gegen sie debuggt. Sie ist deshalb **kein Beleg für „bestes Harness"** — dafür braucht es neutrale Dritt-Benchmarks (z. B. BFCL).
