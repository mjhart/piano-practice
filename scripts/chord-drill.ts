// Writes a chord progression drill: I-IV-V-I then ii-V-I-I in several major
// keys, one chord per measure. The right hand plays triads voiced to move as
// little as possible from one chord to the next; the left hand plays the root.
//
//   npm run chord-drill [-- out.mid]
//
// Edit KEYS, PROGRESSIONS and BPM below to change the drill.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { MidiEvent } from '../app/lib/midi/parse.ts';
import { noteEvents, writeMidi } from '../app/lib/midi/write.ts';
import type { NoteSpec } from '../app/lib/midi/write.ts';

const BPM = 80;
const TPQ = 480;
const MEASURE = TPQ * 4;

// Tonic pitch classes (C = 0).
const KEYS: [string, number][] = [
  ['C', 0],
  ['G', 7],
  ['F', 5],
  ['D', 2],
  ['Bb', 10],
];

// Scale degrees, 1-based.
const PROGRESSIONS = [
  [1, 4, 5, 1],
  [2, 5, 1, 1],
];

const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];

/** Pitch classes of the diatonic triad on `degree` in the key of `tonic`. */
function triad(tonic: number, degree: number): number[] {
  return [0, 2, 4].map((step) => (tonic + MAJOR_SCALE[(degree - 1 + step) % 7]) % 12);
}

/** Every close-position voicing of a triad that sits between G3 and G5. */
function voicings(pcs: number[]): number[][] {
  const result: number[][] = [];
  for (let inversion = 0; inversion < 3; inversion++) {
    const order = [...pcs.slice(inversion), ...pcs.slice(0, inversion)];
    for (let bass = 55; bass < 67; bass++) {
      if (bass % 12 !== order[0]) continue;
      const pitches = [bass];
      for (const pc of order.slice(1)) {
        let p = pitches[pitches.length - 1] + 1;
        while (p % 12 !== pc) p++;
        pitches.push(p);
      }
      if (pitches[2] <= 79) result.push(pitches);
    }
  }
  return result;
}

/** The voicing closest to `previous`, or root position nearest middle C. */
function voice(pcs: number[], previous: number[] | null): number[] {
  const options = voicings(pcs);
  const cost = (v: number[]) =>
    previous ? v.reduce((sum, p, i) => sum + Math.abs(p - previous[i]), 0) : v[0] % 12 === pcs[0] ? Math.abs(v[0] - 60) : Infinity;
  return options.reduce((best, v) => (cost(v) < cost(best) || (cost(v) === cost(best) && v[0] < best[0]) ? v : best));
}

const right: NoteSpec[] = [];
const left: NoteSpec[] = [];
const guide: string[] = [];
let measure = 0;
for (const [name, tonic] of KEYS) {
  guide.push(`${name} major: measures ${measure + 1}-${measure + PROGRESSIONS.flat().length}`);
  for (const progression of PROGRESSIONS) {
    let previous: number[] | null = null;
    for (const degree of progression) {
      const pcs = triad(tonic, degree);
      const pitches = voice(pcs, previous);
      previous = pitches;
      const tick = measure * MEASURE;
      for (const pitch of pitches) right.push({ pitch, tick, duration: MEASURE });
      // Root between E2 and D#3.
      left.push({ pitch: 40 + ((pcs[0] - 4 + 12) % 12), tick, duration: MEASURE, channel: 1 });
      measure++;
    }
  }
}

const conductor: MidiEvent[] = [
  { tick: 0, type: 'trackName', name: 'Chord drill' },
  { tick: 0, type: 'tempo', usPerQuarter: Math.round(60_000_000 / BPM) },
  { tick: 0, type: 'timeSig', numerator: 4, denominator: 4 },
];
const track = (name: string, notes: NoteSpec[]): MidiEvent[] => [{ tick: 0, type: 'trackName', name }, ...noteEvents(notes)];

const path = process.argv[2] ?? 'sample-midis/chord-drill.mid';
mkdirSync(dirname(path), { recursive: true });
writeFileSync(path, writeMidi({ ticksPerQuarter: TPQ, tracks: [conductor, track('Right hand', right), track('Left hand', left)] }));
console.log(`Wrote ${path}: ${measure} measures at ${BPM} bpm`);
for (const line of guide) console.log(`  ${line}`);
