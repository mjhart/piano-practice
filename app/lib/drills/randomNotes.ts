import { keyName } from './common.ts';
import type { BeatNote } from './exercise.ts';
import { buildExercise } from './exercise.ts';
import { KEY_NAMES, isWhite, pitchName } from './theory.ts';
import type { DrillDefinition, Rng } from './types';

// One prompt per short measure: a note, two notes or a triad, picked at random
// within a range. With wait mode on, the music stops at each one until it is
// played, so how long each stop took is the reading speed.

type Config = {
  low: string;
  high: string;
  whiteOnly: boolean;
  size: string;
  maxJump: number;
  count: number;
};

const BEATS = 2;
/** Notes from here up are for the right hand. */
const MIDDLE_C = 60;

const RANGE = Array.from({ length: 61 }, (_, i) => 36 + i).map((p) => ({ value: String(p), label: pitchName(p) }));

const INTERVALS: Record<number, string> = {
  3: 'minor 3rd',
  4: 'major 3rd',
  5: 'perfect 4th',
  6: 'tritone',
  7: 'perfect 5th',
  8: 'minor 6th',
  9: 'major 6th',
  10: 'minor 7th',
  11: 'major 7th',
  12: 'octave',
};

type Prompt = { pitches: number[]; tags: Record<string, string> };

/** Every prompt of the asked size within the range, lowest note first. */
function prompts(config: Config, low: number, high: number): Prompt[] {
  const result: Prompt[] = [];
  const allowed = (pitches: number[]) => pitches.every((p) => p >= low && p <= high && (!config.whiteOnly || isWhite(p)));
  for (let bottom = low; bottom <= high; bottom++) {
    if (config.size === '1') {
      if (allowed([bottom])) result.push({ pitches: [bottom], tags: { note: pitchName(bottom).replace(/-?\d+$/, '') } });
    } else if (config.size === '2') {
      for (const [interval, name] of Object.entries(INTERVALS)) {
        const pitches = [bottom, bottom + Number(interval)];
        if (allowed(pitches)) result.push({ pitches, tags: { interval: name } });
      }
    } else {
      // Close-position major and minor triads in any inversion.
      for (const [quality, third] of [['major', 4], ['minor', 3]] as const) {
        for (let inversion = 0; inversion < 3; inversion++) {
          const tones = [0, third, 7];
          const order = [...tones.slice(inversion), ...tones.slice(0, inversion).map((t) => t + 12)];
          const pitches = order.map((t) => bottom + t - order[0]);
          const root = (bottom - order[0] + 120) % 12;
          if (allowed(pitches)) result.push({ pitches, tags: { chord: `${keyName(KEY_NAMES[root])} ${quality}` } });
        }
      }
    }
  }
  return result;
}

const pick = <T,>(items: T[], rng: Rng) => items[Math.floor(rng() * items.length)];

export const randomNotes: DrillDefinition<Config> = {
  id: 'random-notes',
  name: 'Random notes',
  description: 'Notes, intervals or triads at random, one at a time. Turn on "Wait for each note" to practise reading them quickly.',
  version: 1,
  fields: [
    { kind: 'choice', key: 'low', label: 'Lowest note', options: RANGE },
    { kind: 'choice', key: 'high', label: 'Highest note', options: RANGE },
    {
      kind: 'choice',
      key: 'size',
      label: 'Each prompt',
      options: [
        { value: '1', label: 'One note' },
        { value: '2', label: 'Two notes (an interval)' },
        { value: '3', label: 'A major or minor triad' },
      ],
    },
    { kind: 'toggle', key: 'whiteOnly', label: 'White keys only' },
    { kind: 'number', key: 'maxJump', label: 'Largest jump between prompts (semitones)', min: 1, max: 36 },
    { kind: 'number', key: 'count', label: 'How many prompts', min: 4, max: 96, step: 4 },
  ],
  defaults: { low: '60', high: '79', whiteOnly: true, size: '1', maxJump: 12, count: 24 },
  presets: [
    { id: 'treble-white', name: 'White keys, middle C to G5', config: { low: '60', high: '79', whiteOnly: true, size: '1', maxJump: 12, count: 24 } },
    { id: 'bass-white', name: 'White keys, C2 to middle C', config: { low: '36', high: '60', whiteOnly: true, size: '1', maxJump: 12, count: 24 } },
    { id: 'any-key-wide', name: 'Any key, C2 to C6', config: { low: '36', high: '84', whiteOnly: false, size: '1', maxJump: 24, count: 32 } },
    { id: 'intervals', name: 'Intervals around middle C', config: { low: '55', high: '79', whiteOnly: false, size: '2', maxJump: 7, count: 24 } },
    { id: 'triads', name: 'Major and minor triads', config: { low: '55', high: '79', whiteOnly: false, size: '3', maxJump: 7, count: 24 } },
  ],
  random: () => true,
  generate(config, rng) {
    const [low, high] = [Number(config.low), Number(config.high)].sort((a, b) => a - b);
    // A range too narrow for the prompt widens upwards until something fits.
    let options = prompts(config, low, high);
    for (let top = high + 1; options.length === 0 && top <= 108; top++) options = prompts(config, low, top);

    const notes: BeatNote[] = [];
    const tags: Record<string, string>[] = [];
    let previous: Prompt | null = null;
    for (let i = 0; i < config.count; i++) {
      const last: Prompt | null = previous;
      const near: Prompt[] = last
        ? options.filter((o) => o !== last && Math.abs(o.pitches[0] - last.pitches[0]) <= config.maxJump)
        : options;
      const prompt: Prompt = pick(near.length ? near : options, rng);
      const part = prompt.pitches[0] >= MIDDLE_C ? 0 : 1;
      for (const pitch of prompt.pitches) notes.push({ part, pitch, beat: i * BEATS, beats: BEATS });
      tags.push(prompt.tags);
      previous = prompt;
    }
    return buildExercise({ parts: ['Right hand', 'Left hand'], beatsPerMeasure: BEATS, notes, tags });
  },
  summary(config) {
    const what = { '1': 'notes', '2': 'intervals', '3': 'triads' }[config.size] ?? 'notes';
    const [low, high] = [Number(config.low), Number(config.high)].sort((a, b) => a - b);
    return [`${config.count} ${what}`, `${pitchName(low)} to ${pitchName(high)}`, ...(config.whiteOnly ? ['white keys'] : [])].join(' · ');
  },
};
