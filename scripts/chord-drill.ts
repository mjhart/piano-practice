// Writes a drill's exercise as a MIDI file. The drills themselves live in
// app/lib/drills and are played in the app; this exports one for other tools.
//
//   npm run chord-drill [-- out.mid [preset-id [bpm]]]
//
// With no preset it writes the chord progression drill's first preset:
// I-IV-V-I then ii-V-I-I in C, G, F, D and Bb at 80 bpm.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { MidiEvent } from '../app/lib/midi/parse.ts';
import { noteEvents, writeMidi } from '../app/lib/midi/write.ts';
import { chordProgressions } from '../app/lib/drills/chordProgressions.ts';
import { resolveConfig } from '../app/lib/drills/fields.ts';
import { seededRng } from '../app/lib/drills/random.ts';

const TPQ = 480;
const [path = 'sample-midis/chord-drill.mid', presetId, bpmArg] = process.argv.slice(2);
const bpm = Number(bpmArg) || 80;

const preset = chordProgressions.presets.find((p) => p.id === presetId) ?? chordProgressions.presets[0];
const exercise = chordProgressions.generate(resolveConfig(chordProgressions, preset.config), seededRng(1));
// Exercises are written with one beat per second (REFERENCE_BPM is 60).
const ticks = (seconds: number) => Math.round((seconds * exercise.bpm * TPQ) / 60);

const conductor: MidiEvent[] = [
  { tick: 0, type: 'trackName', name: preset.name },
  { tick: 0, type: 'tempo', usPerQuarter: Math.round(60_000_000 / bpm) },
  { tick: 0, type: 'timeSig', numerator: exercise.beats.filter((b) => b.measure === 0).length, denominator: 4 },
];
const tracks = exercise.tracks.map((track): MidiEvent[] => [
  { tick: 0, type: 'trackName', name: track.name },
  ...noteEvents(
    exercise.notes
      .filter((n) => n.track === track.index)
      .map((n) => ({ pitch: n.pitch, tick: ticks(n.start), duration: ticks(n.duration), velocity: n.velocity, channel: track.index })),
  ),
]);

mkdirSync(dirname(path), { recursive: true });
writeFileSync(path, writeMidi({ ticksPerQuarter: TPQ, tracks: [conductor, ...tracks] }));
console.log(`Wrote ${path}: ${preset.name}, ${exercise.measures.length} measures at ${bpm} bpm`);
