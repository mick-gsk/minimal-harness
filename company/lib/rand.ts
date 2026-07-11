/**
 * Deterministic randomness. Math.random() is forbidden in this artifact — the ground
 * truth in truth/*.jsonl is only stable if the world regenerates identically.
 *
 * Each entity kind draws from its OWN sub-stream, derived by hashing a namespace into
 * the seed. Generators therefore stay order-independent: adding a customer does not
 * shift the surnames of employees.
 */

/** FNV-1a, 32 bit. Used to turn a namespace string into a seed offset. */
export function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [min, max] inclusive. */
  int(min: number, max: number): number;
  /** Picks one element. Throws on an empty array so a silent undefined cannot leak. */
  pick<T>(items: readonly T[]): T;
  /** True with the given probability. */
  chance(probability: number): boolean;
  /** Fisher-Yates copy. Does not mutate the input. */
  shuffle<T>(items: readonly T[]): T[];
}

/** mulberry32 — 32-bit state, well-distributed, ten lines, no dependency. */
export function makeRng(seed: number): Rng {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng: Rng = {
    next,
    int(min, max) {
      return min + Math.floor(next() * (max - min + 1));
    },
    pick(items) {
      if (items.length === 0) throw new Error("rng.pick() on an empty array");
      const item = items[Math.floor(next() * items.length)];
      if (item === undefined) throw new Error("rng.pick() drew undefined");
      return item;
    },
    chance(probability) {
      return next() < probability;
    },
    shuffle(items) {
      const copy = [...items];
      for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        const a = copy[i];
        const b = copy[j];
        if (a === undefined || b === undefined) throw new Error("shuffle index out of range");
        copy[i] = b;
        copy[j] = a;
      }
      return copy;
    },
  };
  return rng;
}

/** A named sub-stream. Same namespace + same root seed => same sequence, always. */
export function streamFor(rootSeed: number, namespace: string): Rng {
  return makeRng((rootSeed ^ fnv1a32(namespace)) >>> 0);
}
