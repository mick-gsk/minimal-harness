# BENCHMARKS

> Datum: 2026-07-09 · Suite: **suite-v1** · k=5 Läufe/Task (Seeds: 1001, 1002, 1003, 1004, 1005) · Temperatur: 0.7 · Intervalle: 95 % Wilson. Baseline `naive` ist **illustrativ** (zeigt den Beitrag von Retry/Recovery), Uplift wird gegen `ollama-native` gemessen.

## Modell: `qwen3:8b`

| Harness | Erfolgsrate | 95 %-CI | pass^5 | Ø Tokens | Ø Latenz |
|---|---|---|---|---|---|
| ollama-native | 90.0% (45/50) | [78.6%, 95.7%] | 90.0% | 1179 | 6142 ms |
| naive | 74.0% (37/50) | [60.4%, 84.1%] | 60.0% | 764 | 4661 ms |
| minimal | 96.0% (48/50) | [86.5%, 98.9%] | 80.0% | 1658 | 14315 ms |
| smolagents-tool | 94.0% (47/50) | [83.8%, 97.9%] | 80.0% | 4306 | 14607 ms |

Harness-Uplift (minimal vs. ollama-native): +6.0 pp — **kein signifikanter Unterschied** (Konfidenzintervalle überlappen; mehr Tasks/Läufe nötig).

## Modell: `llama3.1`

| Harness | Erfolgsrate | 95 %-CI | pass^5 | Ø Tokens | Ø Latenz |
|---|---|---|---|---|---|
| ollama-native | 74.0% (37/50) | [60.4%, 84.1%] | 60.0% | 431 | 774 ms |
| naive | 24.0% (12/50) | [14.3%, 37.4%] | 20.0% | 239 | 454 ms |
| minimal | 82.0% (41/50) | [69.2%, 90.2%] | 80.0% | 834 | 776 ms |
| smolagents-tool | 12.0% (6/50) | [5.6%, 23.8%] | 0.0% | 10611 | 4935 ms |

Harness-Uplift (minimal vs. ollama-native): +8.0 pp — **kein signifikanter Unterschied** (Konfidenzintervalle überlappen; mehr Tasks/Läufe nötig).
