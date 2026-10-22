import type { Run, SongModel } from '../types';
import { duelOutcome } from './duel.ts';
import { matchRun, scoreByTag, scoreRun, type RunScore, type TagValueScore } from './scoring.ts';

// A player's statistics, worked out from their stored runs. Like every score,
// nothing here is stored: it is all recomputed from the raw played events.

/** How one key went: notes written for it that were hit or missed, and presses of it that matched nothing. */
export type KeyTally = { pitch: number; hits: number; misses: number; wrong: number };

/** One run, scored, with what the statistics need from it. */
export type RunStats = {
  run: Run;
  score: RunScore;
  /** Real milliseconds of playing, count-in and waits included. */
  ms: number;
  /** By the key on the keyboard, so a duel counts the keys that player actually used. */
  keys: KeyTally[];
};

/** Real milliseconds a run lasted: its song time at its tempo, plus every wait-mode hold. */
export function runMs(run: Run): number {
  const held = (run.holds ?? []).reduce((sum, h) => sum + h.ms, 0);
  return Math.max(0, ((run.reachedTime - run.originTime) / run.tempoRate) * 1000) + held;
}

export function analyzeRun(model: SongModel, run: Run): RunStats {
  const { notes, matcher, due } = matchRun(model, run);
  const keys = new Map<number, KeyTally>();
  const tally = (pitch: number) => {
    let key = keys.get(pitch);
    if (!key) keys.set(pitch, (key = { pitch, hits: 0, misses: 0, wrong: 0 }));
    return key;
  };
  for (const n of notes) {
    if (matcher.matched.has(n.id)) tally(n.pitch).hits++;
    else if (due(n)) tally(n.pitch).misses++;
  }
  for (const extra of matcher.extras) tally(extra.pitch).wrong++;
  return { run, score: scoreRun(model, run), ms: runMs(run), keys: [...keys.values()] };
}

const ratio = (hits: number, misses: number, extras: number) =>
  hits + misses + extras ? hits / (hits + misses + extras) : null;

// ---- Days ----

/** The local calendar day a time falls on, as YYYY-MM-DD. */
export function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The day `days` after (or before, when negative) a YYYY-MM-DD day. */
export function addDays(day: string, days: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return dayKey(new Date(y, m - 1, d + days).getTime());
}

/** Real milliseconds practised, and runs recorded, on each day that had any practice. */
export function practiceByDay(stats: RunStats[]): Map<string, { ms: number; runs: number }> {
  const days = new Map<string, { ms: number; runs: number }>();
  for (const s of stats) {
    const day = dayKey(s.run.startedAt);
    const total = days.get(day) ?? { ms: 0, runs: 0 };
    days.set(day, total);
    total.ms += s.ms;
    total.runs++;
  }
  return days;
}

/**
 * Days in a row with practice. The current streak is still alive when today
 * has no practice yet but yesterday did.
 */
export function streaks(days: Iterable<string>, today: string): { current: number; longest: number } {
  const set = new Set(days);
  let longest = 0;
  for (const day of set) {
    if (set.has(addDays(day, -1))) continue;
    let length = 1;
    while (set.has(addDays(day, length))) length++;
    longest = Math.max(longest, length);
  }
  let current = 0;
  let day = set.has(today) ? today : addDays(today, -1);
  while (set.has(day)) {
    current++;
    day = addDays(day, -1);
  }
  return { current, longest };
}

// ---- Totals and trends ----

export type Totals = {
  runs: number;
  ms: number;
  days: number;
  hits: number;
  misses: number;
  extras: number;
  accuracy: number | null;
  /** Mean timing offset of hit notes, signed (positive is late) and not. Runs in wait mode don't count. */
  meanErrorMs: number | null;
  meanAbsErrorMs: number | null;
  /** In wait mode, the average real time the music stood waiting, per note written. */
  waitPerNoteMs: number | null;
};

export function totals(stats: RunStats[]): Totals {
  let hits = 0;
  let misses = 0;
  let extras = 0;
  let timed = 0;
  let error = 0;
  let absError = 0;
  let waited = 0;
  let waitedNotes = 0;
  for (const { run, score } of stats) {
    hits += score.hits;
    misses += score.misses;
    extras += score.extras;
    if (run.wait) {
      waited += (run.holds ?? []).reduce((sum, h) => sum + h.ms, 0);
      waitedNotes += score.hits + score.misses;
    } else if (score.meanErrorMs !== null && score.meanAbsErrorMs !== null) {
      timed += score.hits;
      error += score.meanErrorMs * score.hits;
      absError += score.meanAbsErrorMs * score.hits;
    }
  }
  return {
    runs: stats.length,
    ms: stats.reduce((sum, s) => sum + s.ms, 0),
    days: new Set(stats.map((s) => dayKey(s.run.startedAt))).size,
    hits,
    misses,
    extras,
    accuracy: ratio(hits, misses, extras),
    meanErrorMs: timed ? error / timed : null,
    meanAbsErrorMs: timed ? absError / timed : null,
    waitPerNoteMs: waitedNotes ? waited / waitedNotes : null,
  };
}

export type DayPoint = { day: string; runs: number; accuracy: number | null; meanAbsErrorMs: number | null };

/** Accuracy and timing for each day with practice, oldest first. */
export function dailyTrend(stats: RunStats[]): DayPoint[] {
  const byDay = new Map<string, RunStats[]>();
  for (const s of stats) {
    const day = dayKey(s.run.startedAt);
    byDay.set(day, [...(byDay.get(day) ?? []), s]);
  }
  return [...byDay]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([day, list]) => {
      const t = totals(list);
      return { day, runs: list.length, accuracy: t.accuracy, meanAbsErrorMs: t.meanAbsErrorMs };
    });
}

/** Every key that had a note to play or was pressed by mistake, lowest first. */
export function keyboard(stats: RunStats[]): KeyTally[] {
  const keys = new Map<number, KeyTally>();
  for (const s of stats) {
    for (const k of s.keys) {
      const total = keys.get(k.pitch) ?? { pitch: k.pitch, hits: 0, misses: 0, wrong: 0 };
      keys.set(k.pitch, total);
      total.hits += k.hits;
      total.misses += k.misses;
      total.wrong += k.wrong;
    }
  }
  return [...keys.values()].sort((a, b) => a.pitch - b.pitch);
}

// ---- Pieces and drills ----

export type SourceProgress = {
  sourceKey: string;
  runs: number;
  ms: number;
  lastPlayed: number;
  best: number | null;
  /** Accuracy of the most recent runs, oldest first. */
  recent: number[];
  /** The last three runs' average accuracy less the first three's, once there are at least four. */
  change: number | null;
  /** The fastest finished run, not in wait mode, that was at least 90% accurate. */
  fastestClean: Run | null;
};

const RECENT_RUNS = 12;
export const CLEAN_ACCURACY = 0.9;

const average = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** One entry per song or drill, most recently played first. `stats` must be oldest first. */
export function progressBySource(stats: RunStats[]): SourceProgress[] {
  const groups = new Map<string, RunStats[]>();
  for (const s of stats) groups.set(s.run.sourceKey, [...(groups.get(s.run.sourceKey) ?? []), s]);
  return [...groups]
    .map(([sourceKey, list]) => {
      const accuracies = list.map((s) => s.score.accuracy).filter((a): a is number => a !== null);
      let fastestClean: Run | null = null;
      for (const { run, score } of list) {
        if (!run.completed || run.wait || (score.accuracy ?? 0) < CLEAN_ACCURACY) continue;
        if (!fastestClean || run.tempoRate > fastestClean.tempoRate) fastestClean = run;
      }
      return {
        sourceKey,
        runs: list.length,
        ms: list.reduce((sum, s) => sum + s.ms, 0),
        lastPlayed: list.at(-1)!.run.startedAt,
        best: accuracies.length ? Math.max(...accuracies) : null,
        recent: accuracies.slice(-RECENT_RUNS),
        change: accuracies.length >= 4 ? average(accuracies.slice(-3)) - average(accuracies.slice(0, 3)) : null,
        fastestClean,
      };
    })
    .sort((a, b) => b.lastPlayed - a.lastPlayed);
}

export type WeakSection = { from: number; to: number; accuracy: number; notes: number };

/** How many of a measure's latest plays decide where it stands. */
const RECENT_PLAYS = 5;
const WEAK_ACCURACY = 0.85;

/**
 * Runs of neighbouring measures that have been going badly lately, worst
 * first, judged on each measure's last few plays. For one song's runs, oldest
 * first; `range` limits it to the measures the song is trimmed to.
 */
export function weakSections(stats: RunStats[], range: [number, number]): WeakSection[] {
  const plays = new Map<number, { hits: number; misses: number; extras: number }[]>();
  for (const { score } of stats) {
    for (const m of score.measures) {
      if (m.accuracy === null || m.measure < range[0] || m.measure > range[1]) continue;
      plays.set(m.measure, [...(plays.get(m.measure) ?? []), m].slice(-RECENT_PLAYS));
    }
  }
  const standing = new Map<number, { hits: number; misses: number; extras: number }>();
  for (const [measure, list] of plays) {
    const sum = { hits: 0, misses: 0, extras: 0 };
    for (const p of list) {
      sum.hits += p.hits;
      sum.misses += p.misses;
      sum.extras += p.extras;
    }
    if (ratio(sum.hits, sum.misses, sum.extras)! < WEAK_ACCURACY) standing.set(measure, sum);
  }
  const sections: WeakSection[] = [];
  for (const measure of [...standing.keys()].sort((a, b) => a - b)) {
    if (standing.has(measure - 1)) continue;
    const sum = { hits: 0, misses: 0, extras: 0 };
    let to = measure;
    for (; standing.has(to); to++) {
      const s = standing.get(to)!;
      sum.hits += s.hits;
      sum.misses += s.misses;
      sum.extras += s.extras;
    }
    sections.push({
      from: measure,
      to: to - 1,
      accuracy: ratio(sum.hits, sum.misses, sum.extras)!,
      notes: sum.hits + sum.misses,
    });
  }
  return sections.sort((a, b) => a.accuracy - b.accuracy);
}

/**
 * Every run of a drill grouped by its measure labels, such as how each key or
 * chord has gone across all of them. Values are weakest first.
 */
export function tagBreakdown(stats: RunStats[]): { tag: string; values: TagValueScore[] }[] {
  const groups = new Map<string, Map<string, TagValueScore>>();
  for (const { run, score } of stats) {
    if (run.source.kind !== 'drill') continue;
    for (const { tag, values } of scoreByTag(score, run.source.exercise.tags)) {
      const merged = groups.get(tag) ?? new Map<string, TagValueScore>();
      groups.set(tag, merged);
      for (const v of values) {
        const total = merged.get(v.value) ?? { value: v.value, hits: 0, misses: 0, extras: 0, accuracy: null };
        merged.set(v.value, total);
        total.hits += v.hits;
        total.misses += v.misses;
        total.extras += v.extras;
        total.accuracy = ratio(total.hits, total.misses, total.extras);
      }
    }
  }
  return [...groups].map(([tag, values]) => ({
    tag,
    values: [...values.values()].sort((a, b) => (a.accuracy ?? 2) - (b.accuracy ?? 2)),
  }));
}

// ---- Duels ----

export type DuelRecord = { opponentId: string; wins: number; losses: number; draws: number };

/**
 * Wins, losses and draws against each opponent. `theirs` holds the other
 * side's runs; a duel whose other run is gone (its player was removed) is left out.
 */
export function duelRecords(mine: RunStats[], theirs: RunStats[]): DuelRecord[] {
  const other = new Map(theirs.filter((s) => s.run.duel).map((s) => [s.run.duel!.id, s.score]));
  const records = new Map<string, DuelRecord>();
  for (const { run, score } of mine) {
    if (!run.duel) continue;
    const opponent = other.get(run.duel.id);
    if (!opponent) continue;
    const { opponentId } = run.duel;
    const record = records.get(opponentId) ?? { opponentId, wins: 0, losses: 0, draws: 0 };
    records.set(opponentId, record);
    const { winner } = duelOutcome(score, opponent);
    if (winner === null) record.draws++;
    else if (winner === 0) record.wins++;
    else record.losses++;
  }
  return [...records.values()];
}
