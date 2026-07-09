# BENCHMARKS

> Datum: 2026-07-09 · Suite: **suite-v1** · k=5 Läufe/Task (Seeds: 1001, 1002, 1003, 1004, 1005) · Temperatur: 0.7 · Intervalle: 95 % Wilson. Baseline `naive` ist **illustrativ** (zeigt den Beitrag von Retry/Recovery), Uplift wird gegen `ollama-native` gemessen.

## Modell: `qwen3:8b`

| Harness | Erfolgsrate | 95 %-CI | pass^5 | Ø Tokens | Ø Latenz |
|---|---|---|---|---|---|
| ollama-native | 90.0% (45/50) | [78.6%, 95.7%] | 90.0% | 1202 | 7748 ms |
| naive | 66.0% (33/50) | [52.2%, 77.6%] | 60.0% | 692 | 5027 ms |
| minimal | 98.0% (49/50) | [89.5%, 99.6%] | 90.0% | 1719 | 10368 ms |

Harness-Uplift (minimal vs. ollama-native): +8.0 pp — **kein signifikanter Unterschied** (Konfidenzintervalle überlappen; mehr Tasks/Läufe nötig).

## Modell: `llama3.1`

| Harness | Erfolgsrate | 95 %-CI | pass^5 | Ø Tokens | Ø Latenz |
|---|---|---|---|---|---|
| ollama-native | 74.0% (37/50) | [60.4%, 84.1%] | 60.0% | 431 | 944 ms |
| naive | 24.0% (12/50) | [14.3%, 37.4%] | 20.0% | 239 | 574 ms |
| minimal | 82.0% (41/50) | [69.2%, 90.2%] | 80.0% | 834 | 949 ms |

Harness-Uplift (minimal vs. ollama-native): +8.0 pp — **kein signifikanter Unterschied** (Konfidenzintervalle überlappen; mehr Tasks/Läufe nötig).
