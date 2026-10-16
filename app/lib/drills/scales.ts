import { directionField, keyName, keysField, layLines, noteValueField, NOTE_VALUES, octavesField, orderField, orderKeys, placeRun } from './common.ts';
import type { BeatNote } from './exercise.ts';
import { buildExercise } from './exercise.ts';
import { fingeredLine } from './fingering.ts';
import { tonicOf } from './theory.ts';
import type { DrillDefinition } from './types';

// Each scale in each key, hands an octave apart, starting a new measure.

type Config = {
  keys: string[];
  order: string;
  scales: string[];
  octaves: number;
  direction: string;
  motion: string;
  value: string;
};

/** Steps up from the tonic on the way up, and on the way down. */
const SCALES: Record<string, { label: string; up: number[]; down: number[] }> = {
  major: { label: 'major', up: [0, 2, 4, 5, 7, 9, 11], down: [0, 2, 4, 5, 7, 9, 11] },
  'natural-minor': { label: 'natural minor', up: [0, 2, 3, 5, 7, 8, 10], down: [0, 2, 3, 5, 7, 8, 10] },
  'harmonic-minor': { label: 'harmonic minor', up: [0, 2, 3, 5, 7, 8, 11], down: [0, 2, 3, 5, 7, 8, 11] },
  // Raised sixth and seventh going up, natural minor coming down.
  'melodic-minor': { label: 'melodic minor', up: [0, 2, 3, 5, 7, 9, 11], down: [0, 2, 3, 5, 7, 8, 10] },
  'major-pentatonic': { label: 'major pentatonic', up: [0, 2, 4, 7, 9], down: [0, 2, 4, 7, 9] },
  'minor-pentatonic': { label: 'minor pentatonic', up: [0, 3, 5, 7, 10], down: [0, 3, 5, 7, 10] },
  blues: { label: 'blues', up: [0, 3, 5, 6, 7, 10], down: [0, 3, 5, 6, 7, 10] },
  chromatic: { label: 'chromatic', up: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], down: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
};

const BEATS = 4;
/** Contrary motion needs room for both hands to spread apart, so it goes at most two octaves. */
const CONTRARY_OCTAVES = 2;
const CONTRARY: Record<string, string> = { up: 'down', down: 'up', 'up-down': 'down-up' };

const preset = (config: Partial<Config>): Config => ({
  keys: ['C'],
  order: 'picked',
  scales: ['major'],
  octaves: 1,
  direction: 'up-down',
  motion: 'parallel',
  value: 'quarter',
  ...config,
});

export const scales: DrillDefinition<Config> = {
  id: 'scales',
  name: 'Scales',
  description:
    'Scales up and down in the keys you choose, hands together an octave apart or in contrary motion, with the fingering on each note.',
  version: 1,
  fields: [
    keysField('keys'),
    orderField('order'),
    {
      kind: 'multi',
      key: 'scales',
      label: 'Scales',
      options: Object.entries(SCALES).map(([value, s]) => ({ value, label: s.label[0].toUpperCase() + s.label.slice(1) })),
    },
    octavesField('octaves'),
    directionField('direction'),
    {
      kind: 'choice',
      key: 'motion',
      label: 'Hands',
      options: [
        { value: 'parallel', label: 'Same direction, an octave apart' },
        { value: 'contrary', label: 'Contrary motion (up to 2 octaves)' },
      ],
    },
    noteValueField('value'),
  ],
  defaults: preset({ keys: ['C', 'G', 'D', 'F', 'Bb'] }),
  presets: [
    { id: 'major-five-keys', name: 'Major scales in C, G, D, F and B♭', config: preset({ keys: ['C', 'G', 'D', 'F', 'Bb'] }) },
    {
      id: 'all-major-two-octaves',
      name: 'All 12 major scales, two octaves',
      config: preset({ keys: ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'], order: 'fifths-up', octaves: 2, value: 'eighth' }),
    },
    {
      id: 'minor-forms',
      name: 'A minor: natural, harmonic and melodic',
      config: preset({ keys: ['A'], scales: ['natural-minor', 'harmonic-minor', 'melodic-minor'], octaves: 2 }),
    },
    { id: 'contrary-c', name: 'C major in contrary motion', config: preset({ octaves: 2, motion: 'contrary' }) },
    {
      id: 'blues',
      name: 'Blues scales in C, F and G',
      config: preset({ keys: ['C', 'F', 'G'], scales: ['blues'], octaves: 2, value: 'triplet' }),
    },
  ],
  random: (config) => config.order === 'random',
  generate(config, rng) {
    const value = NOTE_VALUES[config.value];
    const contrary = config.motion === 'contrary';
    const octaves = contrary ? Math.min(config.octaves, CONTRARY_OCTAVES) : config.octaves;
    const notes: BeatNote[] = [];
    const tags: Record<string, string>[] = [];
    for (const key of orderKeys(config.keys, config.order, rng)) {
      for (const id of config.scales) {
        const scale = SCALES[id];
        // The right hand from near middle C, kept below C8.
        const right = placeRun(tonicOf(key), 12 * octaves, 60, 108);
        const hands = [
          { part: 0, run: fingeredLine(right, octaves, scale.up, scale.down, config.direction, 'right') },
          {
            part: 1,
            run: contrary
              ? fingeredLine(right - 12 - 12 * octaves, octaves, scale.up, scale.down, CONTRARY[config.direction], 'left')
              : fingeredLine(right - 12, octaves, scale.up, scale.down, config.direction, 'left'),
          },
        ];
        // Each note shows the finger to play it with.
        const lines = hands.map(({ part, run }) => ({
          part,
          pitches: run.map((n) => n.pitch),
          annotations: run.map((n) => String(n.finger)),
        }));
        const measures = layLines(notes, lines, tags.length * BEATS, value, BEATS);
        for (let i = 0; i < measures; i++) tags.push({ key: keyName(key), scale: scale.label });
      }
    }
    return buildExercise({ parts: ['Right hand', 'Left hand'], beatsPerMeasure: BEATS, notes, tags });
  },
  summary(config) {
    const keys = config.keys.length === 1 ? keyName(config.keys[0]) : `${config.keys.length} keys`;
    const kinds = config.scales.map((s) => SCALES[s].label).join(', ');
    const octaves = config.motion === 'contrary' ? Math.min(config.octaves, CONTRARY_OCTAVES) : config.octaves;
    return [kinds, keys, `${octaves} octave${octaves > 1 ? 's' : ''}`, ...(config.motion === 'contrary' ? ['contrary'] : [])].join(' · ');
  },
};
