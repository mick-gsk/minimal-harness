import type { RunRecord } from "./run-matrix.js";
import { passK, wilson } from "./stats.js";

export interface ReportMeta {
  date: string;
  suiteVersion: string;
  seeds: number[];
  temperature: number;
  k: number;
}

interface Cell {
  successes: number;
  n: number;
  rate: number;
  low: number;
  high: number;
  passK: number;
  avgTokens: number;
  avgLatencyMs: number;
  /** Failed runs that also recorded seam faults — not attributable to the harness. */
  seamFails: number;
}

const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;

function aggregate(records: RunRecord[]): Cell {
  const successes = records.filter((r) => r.success).length;
  const n = records.length;
  const w = wilson(successes, n);
  const byTask = new Map<string, boolean[]>();
  for (const r of records) {
    const arr = byTask.get(r.taskId) ?? [];
    arr.push(r.success);
    byTask.set(r.taskId, arr);
  }
  const avg = (f: (r: RunRecord) => number): number =>
    n === 0 ? 0 : records.reduce((s, r) => s + f(r), 0) / n;
  return {
    successes,
    n,
    rate: w.rate,
    low: w.low,
    high: w.high,
    passK: passK([...byTask.values()]),
    avgTokens: avg((r) => r.result.tokens),
    avgLatencyMs: avg((r) => r.result.latencyMs),
    seamFails: records.filter((r) => !r.success && (r.result.seamErrors ?? 0) > 0).length,
  };
}

/** Builds BENCHMARKS.md content (pure; the CLI does the file I/O). */
export function buildReport(records: RunRecord[], meta: ReportMeta): string {
  const models = [...new Set(records.map((r) => r.model))];
  const lines: string[] = [];

  lines.push(`# BENCHMARKS`);
  lines.push(``);
  lines.push(
    `> Datum: ${meta.date} · Suite: **${meta.suiteVersion}** · k=${meta.k} Läufe/Task ` +
      `(Seeds: ${meta.seeds.join(", ")}) · Temperatur: ${meta.temperature} · ` +
      `Intervalle: 95 % Wilson. Baseline \`naive\` ist **illustrativ** (zeigt den Beitrag ` +
      `von Retry/Recovery), Uplift wird gegen \`ollama-native\` gemessen.`,
  );
  lines.push(``);

  for (const model of models) {
    const forModel = records.filter((r) => r.model === model);
    const harnesses = [...new Set(forModel.map((r) => r.harness))];
    const cells = new Map<string, Cell>(
      harnesses.map((h) => [h, aggregate(forModel.filter((r) => r.harness === h))]),
    );

    lines.push(`## Modell: \`${model}\``);
    lines.push(``);
    lines.push(`| Harness | Erfolgsrate | 95 %-CI | pass^${meta.k} | Ø Tokens | Ø Latenz |`);
    lines.push(`|---|---|---|---|---|---|`);
    for (const h of harnesses) {
      const c = cells.get(h)!;
      lines.push(
        `| ${h} | ${pct(c.rate)} (${c.successes}/${c.n}) | [${pct(c.low)}, ${pct(c.high)}] ` +
          `| ${pct(c.passK)} | ${Math.round(c.avgTokens)} | ${Math.round(c.avgLatencyMs)} ms |`,
      );
    }
    lines.push(``);

    for (const h of harnesses) {
      const c = cells.get(h)!;
      if (c.seamFails > 0) {
        lines.push(
          `⚠ \`${h}\`: ${c.seamFails} Fail(s) mit Naht-Fehlern (Sidecar/Bridge) — ` +
            `nicht dem Harness attribuierbar.`,
        );
        lines.push(``);
      }
    }

    const minimal = cells.get("minimal");
    const baseline = cells.get("ollama-native");
    if (minimal && baseline) {
      const upliftPp = (minimal.rate - baseline.rate) * 100;
      const sign = upliftPp >= 0 ? "+" : "";
      const significant = minimal.low > baseline.high || baseline.low > minimal.high;
      if (significant) {
        lines.push(
          `**Harness-Uplift (minimal vs. ollama-native): ${sign}${upliftPp.toFixed(1)} pp** — ` +
            `signifikant (Konfidenzintervalle disjunkt).`,
        );
      } else {
        lines.push(
          `Harness-Uplift (minimal vs. ollama-native): ${sign}${upliftPp.toFixed(1)} pp — ` +
            `**kein signifikanter Unterschied** (Konfidenzintervalle überlappen; mehr Tasks/Läufe nötig).`,
        );
      }
      lines.push(``);
    }
  }

  lines.push(...scopeSection(records));

  return lines.join("\n");
}

/**
 * States explicitly what these numbers can and cannot claim. The in-house
 * suite was designed by minimal's author around minimal's abstractions and
 * minimal was debugged against it — it carries the uplift claim (all arms
 * share tasks, tools, models and seeds; measured is a difference on identical
 * terrain), but not a "beats rival X" claim. Honesty here is deliberate:
 * a benchmark that names its own limits is worth more than any percentage.
 */
function scopeSection(records: RunRecord[]): string[] {
  const hasRival = records.some((r) => !["minimal", "ollama-native", "naive"].includes(r.harness));
  const lines: string[] = [];
  lines.push(`## Geltungsbereich dieser Zahlen`);
  lines.push(``);
  lines.push(
    `- **Was die Suite trägt:** den **Uplift-Claim** (minimal vs. ollama-native/naive) — ` +
      `alle Arme laufen auf identischen Tasks, Tools, Modellen und Seeds; gemessen wird eine ` +
      `Differenz auf gleichem Terrain.`,
  );
  lines.push(
    `- **Was sie nicht trägt:** Diese Suite ist vom Autor von minimal-harness entworfen und ` +
      `minimal wurde gegen sie debuggt. Sie ist deshalb **kein Beleg für „bestes Harness"** — ` +
      `dafür braucht es neutrale Dritt-Benchmarks (z. B. BFCL).`,
  );
  if (hasRival) {
    lines.push(
      `- **Fremd-Harness-Zahlen sind orientierend, nicht beweisend:** Rivalen laufen mit ` +
        `**off-the-shelf**-Defaults auf einer Suite mit Heimspiel-Vorteil für minimal und werden ` +
        `über eine Sidecar-/HTTP-Naht integriert (sanitisierte Tool-Namen, Timeouts, Prozess-Spawn) ` +
        `— jede Naht ist ein möglicher Verlustort, der nichts mit Harness-Qualität zu tun hat.`,
    );
  }
  lines.push(``);
  return lines;
}
