import type { DrillConfig } from '../../types';
import type { BeatNote } from './exercise.ts';
import { shuffle } from './random.ts';
import { KEY_NAMES, circleOrder } from './theory.ts';
import type { Field, Rng } from './types';

// Settings and building blocks several drills share.

export const keyName = (key: string) => key.replace('b', '♭').replace('#', '♯');

export function keysField<C extends DrillConfig>(key: keyof C & string): Field<C> {
  return { kind: 'multi', key, label: 'Keys', options: KEY_NAMES.map((k) => ({ value: k, label: keyName(k) })) };
}

export function orderField<C extends DrillConfig>(key: keyof C & string): Field<C> {
  return {
    kind: 'choice',
    key,
    label: 'Key order',
    options: [
      { value: 'picked', label: 'In the order picked' },
      { value: 'fifths-up', label: 'Up in fifths (C G D…)' },
      { value: 'fifths-down', label: 'Down in fifths (C F B♭…)' },
      { value: 'random', label: 'Random' },
    ],
  };
}

/** The keys in the order an `orderField` asks for. */
export function orderKeys(keys: string[], order: string, rng: Rng): string[] {
  if (order === 'random') return shuffle(keys, rng);
  if (order === 'fifths-up' || order === 'fifths-down') return circleOrder(keys, order === 'fifths-up' ? 'up' : 'down');
  return keys;
}

export function octavesField<C extends DrillConfig>(key: keyof C & string): Field<C> {
  return { kind: 'number', key, label: 'Octaves', min: 1, max: 4 };
}

export function directionField<C extends DrillConfig>(key: keyof C & string): Field<C> {
  return {
    kind: 'choice',
    key,
    label: 'Direction',
    options: [
      { value: 'up-down', label: 'Up and back down' },
      { value: 'up', label: 'Up' },
      { value: 'down', label: 'Down' },
    ],
  };
}

/** Note lengths in beats. */
export const NOTE_VALUES: Record<string, number> = { quarter: 1, eighth: 1 / 2, triplet: 1 / 3, sixteenth: 1 / 4 };

export function noteValueField<C extends DrillConfig>(key: keyof C & string): Field<C> {
  return {
    kind: 'choice',
    key,
    label: 'Notes',
    options: [
      { value: 'quarter', label: 'Quarter notes' },
      { value: 'eighth', label: 'Eighth notes' },
      { value: 'triplet', label: 'Triplets' },
      { value: 'sixteenth', label: 'Sixteenth notes' },
    ],
  };
}

/**
 * Pitches from `bottom` up `octaves` octaves and back, following `up` (steps
 * within an octave, from 0) on the way up and `down` on the way down, as
 * melodic minor does. 'down-up' starts at the top.
 */
export function line(bottom: number, octaves: number, up: number[], down: number[], direction: string): number[] {
  const climb = (steps: number[]) => [
    ...Array.from({ length: octaves }, (_, o) => steps.map((s) => bottom + 12 * o + s)).flat(),
    bottom + 12 * octaves,
  ];
  const rising = climb(up);
  const falling = climb(down).reverse();
  if (direction === 'up') return rising;
  if (direction === 'down') return falling;
  if (direction === 'down-up') return [...falling, ...rising.slice(1)];
  return [...rising, ...falling.slice(1)];
}

/**
 * Lays parts that play together, one note per `value` beats, from `beat`. The
 * last note of each part is held to the end of the measure. Returns the
 * number of measures used.
 */
export function layLines(
  notes: BeatNote[],
  lines: { part: number; pitches: number[] }[],
  beat: number,
  value: number,
  beatsPerMeasure: number,
): number {
  const length = Math.max(...lines.map((l) => l.pitches.length));
  const measures = Math.max(1, Math.ceil((length * value - 1e-9) / beatsPerMeasure));
  const end = beat + measures * beatsPerMeasure;
  for (const { part, pitches } of lines) {
    pitches.forEach((pitch, i) => {
      const at = beat + i * value;
      notes.push({ part, pitch, beat: at, beats: i === pitches.length - 1 ? end - at : value });
    });
  }
  return measures;
}

/** Where a run of `span` semitones starts: on pitch class `pc` at or above `preferred`, an octave lower at a time until it ends at or below `high`. */
export function placeRun(pc: number, span: number, preferred: number, high: number): number {
  let start = preferred + ((pc - preferred + 120) % 12);
  while (start + span > high) start -= 12;
  return start;
}
