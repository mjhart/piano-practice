import { directionField, keyName, keysField, layLines, noteValueField, NOTE_VALUES, octavesField, orderField, orderKeys, placeRun } from './common.ts';
import type { BeatNote } from './exercise.ts';
import { buildExercise } from './exercise.ts';
import { fingeredArpeggio } from './fingering.ts';
import { tonicOf } from './theory.ts';
import type { DrillDefinition } from './types';

// Broken chords across octaves, hands an octave apart, each starting a new measure.

type Config = {
  keys: string[];
  order: string;
  chords: string[];
  inversion: string;
  octaves: number;
  direction: string;
  value: string;
};

const CHORDS: Record<string, { label: string; tones: number[] }> = {
  major: { label: 'major', tones: [0, 4, 7] },
  minor: { label: 'minor', tones: [0, 3, 7] },
  dominant7: { label: 'dominant 7th', tones: [0, 4, 7, 10] },
  diminished7: { label: 'diminished 7th', tones: [0, 3, 6, 9] },
};

const INVERSIONS = ['root position', '1st inversion', '2nd inversion', '3rd inversion'];

const BEATS = 4;

const preset = (config: Partial<Config>): Config => ({
  keys: ['C'],
  order: 'picked',
  chords: ['major'],
  inversion: 'root',
  octaves: 2,
  direction: 'up-down',
  value: 'quarter',
  ...config,
});

export const arpeggios: DrillDefinition<Config> = {
  id: 'arpeggios',
  name: 'Arpeggios',
  description: 'Chords broken across octaves, from the root or any inversion, hands together an octave apart, with the fingering on each note.',
  version: 1,
  fields: [
    keysField('keys'),
    orderField('order'),
    {
      kind: 'multi',
      key: 'chords',
      label: 'Chords',
      options: Object.entries(CHORDS).map(([value, c]) => ({ value, label: c.label[0].toUpperCase() + c.label.slice(1) })),
    },
    {
      kind: 'choice',
      key: 'inversion',
      label: 'Starting from',
      options: [
        { value: 'root', label: 'The root' },
        { value: 'first', label: 'First inversion' },
        { value: 'second', label: 'Second inversion' },
        { value: 'all', label: 'Each inversion in turn' },
      ],
    },
    octavesField('octaves'),
    directionField('direction'),
    noteValueField('value'),
  ],
  defaults: preset({ keys: ['C', 'G', 'F'], chords: ['major', 'minor'] }),
  presets: [
    { id: 'major-minor', name: 'Major and minor in C, G and F', config: preset({ keys: ['C', 'G', 'F'], chords: ['major', 'minor'] }) },
    { id: 'c-inversions', name: 'C major through every inversion', config: preset({ inversion: 'all' }) },
    {
      id: 'sevenths',
      name: 'Dominant and diminished sevenths',
      config: preset({ keys: ['C', 'G', 'D'], chords: ['dominant7', 'diminished7'], value: 'eighth' }),
    },
    {
      id: 'all-major-keys',
      name: 'Major arpeggios in all 12 keys',
      config: preset({ keys: ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'], order: 'fifths-up' }),
    },
  ],
  random: (config) => config.order === 'random',
  generate(config, rng) {
    const value = NOTE_VALUES[config.value];
    const notes: BeatNote[] = [];
    const tags: Record<string, string>[] = [];
    for (const key of orderKeys(config.keys, config.order, rng)) {
      for (const id of config.chords) {
        const chord = CHORDS[id];
        const inversions =
          config.inversion === 'all'
            ? chord.tones.map((_, i) => i)
            : [Math.min({ root: 0, first: 1, second: 2 }[config.inversion] ?? 0, chord.tones.length - 1)];
        for (const inversion of inversions) {
          // The chord tones as steps up from the inversion's lowest note.
          const first = chord.tones[inversion];
          const steps = [...chord.tones.slice(inversion), ...chord.tones.slice(0, inversion).map((t) => t + 12)].map((t) => t - first);
          const right = placeRun((tonicOf(key) + first) % 12, 12 * config.octaves, 60, 108);
          const hands = [
            { part: 0, run: fingeredArpeggio(right, config.octaves, steps, config.direction, 'right') },
            { part: 1, run: fingeredArpeggio(right - 12, config.octaves, steps, config.direction, 'left') },
          ];
          // Each note shows the finger to play it with.
          const lines = hands.map(({ part, run }) => ({
            part,
            pitches: run.map((n) => n.pitch),
            annotations: run.map((n) => String(n.finger)),
          }));
          const measures = layLines(notes, lines, tags.length * BEATS, value, BEATS);
          const name = `${keyName(key)} ${chord.label}`;
          for (let i = 0; i < measures; i++) tags.push({ chord: name, inversion: INVERSIONS[inversion] });
        }
      }
    }
    return buildExercise({ parts: ['Right hand', 'Left hand'], beatsPerMeasure: BEATS, notes, tags });
  },
  summary(config) {
    const keys = config.keys.length === 1 ? keyName(config.keys[0]) : `${config.keys.length} keys`;
    const kinds = config.chords.map((c) => CHORDS[c].label).join(', ');
    const from = config.inversion === 'all' ? 'every inversion' : config.inversion === 'root' ? '' : `${config.inversion} inversion`;
    return [kinds, keys, `${config.octaves} octave${config.octaves > 1 ? 's' : ''}`, from].filter(Boolean).join(' · ');
  },
};
