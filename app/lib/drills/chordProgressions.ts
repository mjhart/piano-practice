import { keysField, orderField, orderKeys } from './common.ts';
import type { BeatNote } from './exercise.ts';
import { buildExercise } from './exercise.ts';
import { KEY_NAMES, bassRoot, diatonicChord, keyLabel, numeral, parseNumerals, rootPosition, tonicOf, voice } from './theory.ts';
import type { Mode } from './theory.ts';
import type { DrillDefinition } from './types';

// One chord per 4/4 measure, through each progression in each key. The right
// hand plays the chord, the left hand its root.

type Config = {
  keys: string[];
  order: string;
  progressions: string[];
  custom: string;
  mode: string;
  size: string;
  voicing: string;
  pattern: string;
};

const PROGRESSIONS: Record<string, number[]> = {
  'I-IV-V-I': [1, 4, 5, 1],
  'ii-V-I-I': [2, 5, 1, 1],
  'ii-V-I': [2, 5, 1],
  'I-vi-IV-V': [1, 6, 4, 5],
  'I-V-vi-IV': [1, 5, 6, 4],
  'I-IV-I-V': [1, 4, 1, 5],
};

const BEATS = 4;

/** The right hand's notes for one measure, as [offset in beats, length, pitches]. */
function pattern(name: string, chord: number[]): [number, number, number[]][] {
  const low = chord[0];
  const high = chord[chord.length - 1];
  const middle = chord[1];
  switch (name) {
    case 'repeated':
      return [0, 1, 2, 3].map((beat) => [beat, 1, chord]);
    case 'broken':
      // Up the chord in quarters, then back to the middle note for a triad.
      return [...chord, ...(chord.length === 3 ? [middle] : [])].map((p, i) => [i, 1, [p]]);
    case 'alberti':
      return [low, high, middle, high, low, high, middle, high].map((p, i) => [i / 2, 0.5, [p]]);
    default:
      return [[0, BEATS, chord]];
  }
}

export const chordProgressions: DrillDefinition<Config> = {
  id: 'chord-progressions',
  name: 'Chord progressions',
  description: 'Common progressions through the keys you choose, one chord per measure, voiced to move as little as possible.',
  version: 1,
  fields: [
    keysField('keys'),
    orderField('order'),
    {
      kind: 'multi',
      key: 'progressions',
      label: 'Progressions',
      options: Object.keys(PROGRESSIONS).map((p) => ({ value: p, label: p })),
    },
    { kind: 'text', key: 'custom', label: 'Your own progression', hint: 'Roman numerals, e.g. I vi ii V' },
    {
      kind: 'choice',
      key: 'mode',
      label: 'Major or minor',
      options: [
        { value: 'major', label: 'Major keys' },
        { value: 'minor', label: 'Minor keys (same degrees)' },
      ],
    },
    {
      kind: 'choice',
      key: 'size',
      label: 'Chords',
      options: [
        { value: 'triads', label: 'Triads' },
        { value: 'sevenths', label: 'Seventh chords' },
      ],
    },
    {
      kind: 'choice',
      key: 'voicing',
      label: 'Voicing',
      options: [
        { value: 'led', label: 'Smooth (nearest inversion)' },
        { value: 'root', label: 'Root position' },
      ],
    },
    {
      kind: 'choice',
      key: 'pattern',
      label: 'Right hand',
      options: [
        { value: 'block', label: 'Held chords' },
        { value: 'repeated', label: 'Chord on every beat' },
        { value: 'broken', label: 'Broken chords' },
        { value: 'alberti', label: 'Alberti pattern' },
      ],
    },
  ],
  defaults: {
    keys: ['C', 'G', 'F', 'D', 'Bb'],
    order: 'picked',
    progressions: ['I-IV-V-I', 'ii-V-I-I'],
    custom: '',
    mode: 'major',
    size: 'triads',
    voicing: 'led',
    pattern: 'block',
  },
  presets: [
    {
      id: 'five-keys',
      name: 'I-IV-V-I and ii-V-I in five keys',
      config: {
        keys: ['C', 'G', 'F', 'D', 'Bb'],
        order: 'picked',
        progressions: ['I-IV-V-I', 'ii-V-I-I'],
        custom: '',
        mode: 'major',
        size: 'triads',
        voicing: 'led',
        pattern: 'block',
      },
    },
    {
      id: 'ii-V-I-all-keys',
      name: 'ii-V-I sevenths in all 12 keys',
      config: {
        keys: [...KEY_NAMES],
        order: 'fifths-down',
        progressions: ['ii-V-I-I'],
        custom: '',
        mode: 'major',
        size: 'sevenths',
        voicing: 'led',
        pattern: 'block',
      },
    },
    {
      id: 'pop-broken',
      name: 'I-V-vi-IV as broken chords',
      config: {
        keys: ['C', 'G', 'D', 'F'],
        order: 'picked',
        progressions: ['I-V-vi-IV'],
        custom: '',
        mode: 'major',
        size: 'triads',
        voicing: 'led',
        pattern: 'broken',
      },
    },
    {
      id: 'minor-keys',
      name: 'i-iv-V-i in minor keys',
      config: {
        keys: ['A', 'E', 'D'],
        order: 'picked',
        progressions: ['I-IV-V-I'],
        custom: '',
        mode: 'minor',
        size: 'triads',
        voicing: 'led',
        pattern: 'block',
      },
    },
  ],
  random: (config) => config.order === 'random',
  generate(config, rng) {
    const mode = config.mode as Mode;
    const size = config.size === 'sevenths' ? 4 : 3;
    const keys = orderKeys(config.keys, config.order, rng);
    const progressions = config.progressions.map((p) => PROGRESSIONS[p]).filter(Boolean);
    const custom = parseNumerals(config.custom);
    if (custom.length) progressions.push(custom);

    const notes: BeatNote[] = [];
    const tags: Record<string, string>[] = [];
    for (const key of keys) {
      const tonic = tonicOf(key);
      for (const progression of progressions) {
        let previous: number[] | null = null;
        for (const degree of progression) {
          const pcs = diatonicChord(tonic, mode, degree, size);
          const chord: number[] = config.voicing === 'root' ? rootPosition(pcs) : voice(pcs, previous);
          previous = chord;
          const beat = tags.length * BEATS;
          for (const [offset, beats, pitches] of pattern(config.pattern, chord)) {
            for (const pitch of pitches) notes.push({ part: 0, pitch, beat: beat + offset, beats });
          }
          notes.push({ part: 1, pitch: bassRoot(pcs[0]), beat, beats: BEATS });
          tags.push({ key: keyLabel(key, mode), chord: numeral(degree, pcs) });
        }
      }
    }
    return buildExercise({ parts: ['Right hand', 'Left hand'], beatsPerMeasure: BEATS, notes, tags });
  },
  summary(config) {
    const progressions = [...config.progressions, ...(parseNumerals(config.custom).length ? [config.custom.trim()] : [])];
    const keys = config.keys.length === 1 ? keyLabel(config.keys[0], config.mode as Mode) : `${config.keys.length} ${config.mode} keys`;
    return [progressions.join(', '), keys, config.size === 'sevenths' ? 'sevenths' : 'triads'].join(' · ');
  },
};
