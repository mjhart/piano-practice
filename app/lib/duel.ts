import type { RunScore } from './scoring';
import { pitchName } from './drills/theory.ts';

// A duel: two players at one keyboard play the same part, each at their own
// end, whole octaves apart. A note played belongs to whichever side of the
// split it is on, and each side is scored as its own run.

/** The lowest and highest keys of an 88-key piano. */
const LOWEST_KEY = 21;
const HIGHEST_KEY = 108;

/** Semitones the part is moved for the player at the low end and the one at the high end. */
export type DuelLayout = { low: number; high: number };

/**
 * Every way to fit two copies of the part on a piano, lowest first: whole
 * octaves apart, as close as they can be without sharing a key. Empty when the
 * part is too wide for two.
 */
export function duelLayouts(pitches: number[]): DuelLayout[] {
  if (pitches.length === 0) return [];
  const lowest = Math.min(...pitches);
  const highest = Math.max(...pitches);
  const apart = 12 * (Math.floor((highest - lowest) / 12) + 1);
  const layouts: DuelLayout[] = [];
  for (let low = 12 * Math.ceil((LOWEST_KEY - lowest) / 12); highest + low + apart <= HIGHEST_KEY; low += 12) {
    layouts.push({ low, high: low + apart });
  }
  return layouts;
}

/** The layout that moves the part least overall, keeping the high end as written on a tie. */
export function defaultDuelLayout(layouts: DuelLayout[]): DuelLayout | null {
  let best: DuelLayout | null = null;
  for (const layout of layouts) {
    if (!best || Math.abs(layout.low + layout.high) < Math.abs(best.low + best.high)) best = layout;
  }
  return best;
}

/** The lowest key that belongs to the player at the high end: halfway across the gap between the two copies. */
export function duelSplit(pitches: number[], layout: DuelLayout): number {
  const lowTop = Math.max(...pitches) + layout.low;
  const highBottom = Math.min(...pitches) + layout.high;
  return Math.floor((lowTop + highBottom) / 2) + 1;
}

/** "C2–G3": the keys one side plays. */
export function duelRange(pitches: number[], shift: number): string {
  return `${pitchName(Math.min(...pitches) + shift)}–${pitchName(Math.max(...pitches) + shift)}`;
}

export type DuelOutcome = {
  /** 0 when the first score wins, 1 when the second does, null for a draw. */
  winner: 0 | 1 | null;
  /** What decided it. */
  by: 'accuracy' | 'hits' | 'timing' | null;
};

/** Accuracy decides, then notes hit, then the steadier timing. */
export function duelOutcome(a: RunScore, b: RunScore): DuelOutcome {
  const accuracy = (s: RunScore) => Math.round((s.accuracy ?? -1) * 1000);
  if (accuracy(a) !== accuracy(b)) return { winner: accuracy(a) > accuracy(b) ? 0 : 1, by: 'accuracy' };
  if (a.hits !== b.hits) return { winner: a.hits > b.hits ? 0 : 1, by: 'hits' };
  if (a.meanAbsErrorMs !== null && b.meanAbsErrorMs !== null && Math.round(a.meanAbsErrorMs) !== Math.round(b.meanAbsErrorMs)) {
    return { winner: a.meanAbsErrorMs < b.meanAbsErrorMs ? 0 : 1, by: 'timing' };
  }
  return { winner: null, by: null };
}
