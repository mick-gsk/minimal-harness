# BENCHMARKS

> Datum: 2026-07-09 · Suite: **suite-v1** · k=5 Läufe/Task (Seeds: 1001, 1002, 1003, 1004, 1005) · Temperatur: 0.7 · Intervalle: 95 % Wilson. Baseline `naive` ist **illustrativ** (zeigt den Beitrag von Retry/Recovery), Uplift wird gegen `ollama-native` gemessen.

## Modell: `qwen3:8b`

| Harness | Erfolgsrate | 95 %-CI | pass^5 | Ø Tokens | Ø Latenz |
|---|---|---|---|---|---|
| ollama-native | 90.0% (45/50) | [78.6%, 95.7%] | 90.0% | 1181 | 12828 ms |
| naive | 68.0% (34/50) | [54.2%, 79.2%] | 60.0% | 740 | 5959 ms |
| minimal | 98.0% (49/50) | [89.5%, 99.6%] | 90.0% | 1612 | 35122 ms |
| smolagents-tool | 0.0% (0/50) | [0.0%, 7.1%] | 0.0% | 0 | 21 ms |

Harness-Uplift (minimal vs. ollama-native): +8.0 pp — **kein signifikanter Unterschied** (Konfidenzintervalle überlappen; mehr Tasks/Läufe nötig).

## Modell: `llama3.1`

| Harness | Erfolgsrate | 95 %-CI | pass^5 | Ø Tokens | Ø Latenz |
|---|---|---|---|---|---|
| ollama-native | 72.0% (36/50) | [58.3%, 82.5%] | 70.0% | 434 | 902 ms |
| naive | 24.0% (12/50) | [14.3%, 37.4%] | 20.0% | 239 | 437 ms |
| minimal | 82.0% (41/50) | [69.2%, 90.2%] | 80.0% | 834 | 754 ms |
| smolagents-tool | 0.0% (0/50) | [0.0%, 7.1%] | 0.0% | 0 | 21 ms |

Harness-Uplift (minimal vs. ollama-native): +10.0 pp — **kein signifikanter Unterschied** (Konfidenzintervalle überlappen; mehr Tasks/Läufe nötig).
