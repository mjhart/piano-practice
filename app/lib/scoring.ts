import type { Hold, Note, Run, SongModel } from '../types';

export const DEFAULT_TOLERANCE_MS = 150;

export type MeasureScore = {
  measure: number;
  hits: number;
  misses: number;
  extras: number;
  /** null when the measure wasn't reached or had nothing to play. */
  accuracy: number | null;
  meanAbsErrorMs: number | null;
};

export type RunScore = {
  hits: number;
  misses: number;
  extras: number;
  accuracy: number | null;
  meanAbsErrorMs: number | null;
  /** Signed: positive means the player tends to be late. */
  meanErrorMs: number | null;
  measures: MeasureScore[];
};

type Selection = Pick<Run, 'tracks' | 'startMeasure' | 'endMeasure' | 'transpose'>;

/** The notes the player is expected to play, in start order, moved by `transpose` semitones. */
export function expectedNotes(song: SongModel, sel: Selection): Note[] {
  const tracks = new Set(sel.tracks);
  const notes = song.notes.filter(
    (n) => tracks.has(n.track) && n.measure >= sel.startMeasure && n.measure <= sel.endMeasure,
  );
  const shift = sel.transpose ?? 0;
  return shift ? notes.map((n) => ({ ...n, pitch: n.pitch + shift })) : notes;
}

type Clock = Pick<Run, 'originTime' | 'tempoRate' | 'holds'>;

/** Song time at t real milliseconds into a run. The clock stands still during holds. */
export function songTimeOf(run: Clock, t: number): number {
  let held = 0;
  for (const hold of run.holds ?? []) {
    const from = ((hold.at - run.originTime) / run.tempoRate) * 1000 + held;
    if (t < from) break;
    if (t < from + hold.ms) return hold.at;
    held += hold.ms;
  }
  return run.originTime + ((t - held) / 1000) * run.tempoRate;
}

function measureAt(song: SongModel, time: number): number {
  let i = 0;
  while (i + 1 < song.measures.length && song.measures[i + 1].start <= time) i++;
  return i;
}

/**
 * Pairs played notes with expected notes. Used live while practicing and again
 * when a stored run is scored, so both always agree.
 */
export class Matcher {
  /** Expected note id to timing error in real milliseconds (positive is late). */
  readonly matched = new Map<number, number>();
  readonly extras: { time: number; pitch: number }[] = [];
  private byPitch = new Map<number, Note[]>();
  private tolSec: number;
  private rate: number;
  private rangeStart: number;

  constructor(notes: Note[], toleranceMs: number, rate: number, rangeStart: number) {
    // The tolerance is fixed in real time, so it widens in song time as the tempo rises.
    this.tolSec = (toleranceMs / 1000) * rate;
    this.rate = rate;
    this.rangeStart = rangeStart;
    for (const n of notes) {
      const list = this.byPitch.get(n.pitch);
      if (list) list.push(n);
      else this.byPitch.set(n.pitch, [n]);
    }
  }

  noteOn(songTime: number, pitch: number): Note | null {
    const best = this.find(songTime, pitch);
    if (best) {
      this.matched.set(best.id, ((songTime - best.start) / this.rate) * 1000);
    } else if (songTime >= this.rangeStart - this.tolSec) {
      // Anything played during the count-in is ignored rather than penalised.
      this.extras.push({ time: songTime, pitch });
    }
    return best;
  }

  /** Whether noteOn would pair this with an expected note. Changes nothing. */
  wouldMatch(songTime: number, pitch: number): boolean {
    return this.find(songTime, pitch) !== null;
  }

  private find(songTime: number, pitch: number): Note | null {
    let best: Note | null = null;
    let bestDistance = Infinity;
    for (const n of this.byPitch.get(pitch) ?? []) {
      if (n.start - songTime > this.tolSec) break;
      if (this.matched.has(n.id)) continue;
      const distance = Math.abs(n.start - songTime);
      if (distance <= this.tolSec && distance < bestDistance) {
        best = n;
        bestDistance = distance;
      }
    }
    return best;
  }
}

/**
 * Wait mode. The song may not pass the earliest expected note that hasn't been
 * played, so the clock stops there until the Matcher pairs it. The stops are
 * recorded as holds, which is all scoreRun needs to replay the same clock.
 */
export class WaitGate {
  readonly holds: Hold[] = [];
  readonly originTime: number;
  readonly tempoRate: number;
  private notes: Note[];
  private matcher: Matcher;
  private next = 0;
  /** The song time the clock stops at, or null once every note has been played. */
  private at: number | null;

  /** notes must be in start order and the same ones the matcher was given. */
  constructor(notes: Note[], matcher: Matcher, originTime: number, tempoRate: number) {
    this.notes = notes;
    this.matcher = matcher;
    this.originTime = originTime;
    this.tempoRate = tempoRate;
    this.at = this.nextStop();
  }

  /** Song time at t real milliseconds into the run. */
  songTime(t: number): number {
    const free = songTimeOf(this, t);
    return this.at !== null && free > this.at ? this.at : free;
  }

  /** Every note has been played, so the clock runs free to the end. */
  get released(): boolean {
    return this.at === null;
  }

  /** Whether the clock is stopped at t, waiting for notes. */
  waiting(t: number): boolean {
    return this.at !== null && songTimeOf(this, t) > this.at;
  }

  /** Unplayed notes starting within `window` song seconds of the stop. */
  pending(window: number): Note[] {
    const result: Note[] = [];
    if (this.at === null) return result;
    for (let i = this.next; i < this.notes.length && this.notes[i].start <= this.at + window; i++) {
      if (!this.matcher.matched.has(this.notes[i].id)) result.push(this.notes[i]);
    }
    return result;
  }

  /**
   * Call straight after the matcher sees a note-on at t, and once more when
   * the run ends. If that released (or ended) a stop, it is recorded as a hold.
   */
  update(t: number, ended = false) {
    const stop = this.at;
    this.at = this.nextStop();
    if (stop === null || (stop === this.at && !ended)) return;
    // The real time the clock reached the stop; before that it wasn't held.
    const held = this.holds.reduce((sum, h) => sum + h.ms, 0);
    const from = ((stop - this.originTime) / this.tempoRate) * 1000 + held;
    if (t > from) this.holds.push({ at: stop, ms: t - from });
  }

  private nextStop(): number | null {
    while (this.next < this.notes.length && this.matcher.matched.has(this.notes[this.next].id)) this.next++;
    return this.next < this.notes.length ? this.notes[this.next].start : null;
  }
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const ratio = (hits: number, misses: number, extras: number) =>
  hits + misses + extras ? hits / (hits + misses + extras) : null;

/** Scores a stored run from its raw events. */
export function scoreRun(song: SongModel, run: Run): RunScore {
  const notes = expectedNotes(song, run);
  const tolSec = (run.toleranceMs / 1000) * run.tempoRate;
  const rangeStart = song.measures[run.startMeasure].start;
  const matcher = new Matcher(notes, run.toleranceMs, run.tempoRate, rangeStart);
  for (const e of run.events) {
    if (e.on) matcher.noteOn(songTimeOf(run, e.t), e.pitch);
  }

  const tally = new Map<number, { hits: number; misses: number; extras: number; errors: number[] }>();
  for (let m = run.startMeasure; m <= run.endMeasure; m++) {
    tally.set(m, { hits: 0, misses: 0, extras: 0, errors: [] });
  }
  const errors: number[] = [];
  for (const n of notes) {
    const t = tally.get(n.measure)!;
    const error = matcher.matched.get(n.id);
    if (error !== undefined) {
      t.hits++;
      t.errors.push(error);
      errors.push(error);
    } else if (n.start <= run.reachedTime - tolSec) {
      // A note the player could still have hit when the run stopped is not a miss.
      t.misses++;
    }
  }
  for (const extra of matcher.extras) {
    const m = Math.min(Math.max(measureAt(song, extra.time), run.startMeasure), run.endMeasure);
    tally.get(m)!.extras++;
  }

  const measures: MeasureScore[] = [...tally.entries()].map(([measure, t]) => ({
    measure,
    hits: t.hits,
    misses: t.misses,
    extras: t.extras,
    accuracy: ratio(t.hits, t.misses, t.extras),
    meanAbsErrorMs: mean(t.errors.map(Math.abs)),
  }));
  const hits = errors.length;
  const misses = measures.reduce((sum, m) => sum + m.misses, 0);
  const extras = matcher.extras.length;
  return {
    hits,
    misses,
    extras,
    accuracy: ratio(hits, misses, extras),
    meanAbsErrorMs: mean(errors.map(Math.abs)),
    meanErrorMs: mean(errors),
    measures,
  };
}

export type TagValueScore = { value: string; hits: number; misses: number; extras: number; accuracy: number | null };

/**
 * A run's score grouped by each of its measure labels, such as every measure
 * in B♭ major or every ii chord. Values appear in the order first played;
 * measures that weren't reached count for nothing.
 */
export function scoreByTag(score: RunScore, tags: Record<string, string>[]): { tag: string; values: TagValueScore[] }[] {
  const groups = new Map<string, Map<string, TagValueScore>>();
  for (const m of score.measures) {
    if (m.accuracy === null) continue;
    for (const [tag, value] of Object.entries(tags[m.measure] ?? {})) {
      const values = groups.get(tag) ?? new Map<string, TagValueScore>();
      groups.set(tag, values);
      const total = values.get(value) ?? { value, hits: 0, misses: 0, extras: 0, accuracy: null };
      values.set(value, total);
      total.hits += m.hits;
      total.misses += m.misses;
      total.extras += m.extras;
      total.accuracy = ratio(total.hits, total.misses, total.extras);
    }
  }
  return [...groups].map(([tag, values]) => ({ tag, values: [...values.values()] }));
}
