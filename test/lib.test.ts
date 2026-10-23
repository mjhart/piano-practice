import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseMidi } from '../app/lib/midi/parse.ts';
import { buildSongModel } from '../app/lib/midi/songModel.ts';
import { noteEvents, writeMidi } from '../app/lib/midi/write.ts';
import { arpeggios } from '../app/lib/drills/arpeggios.ts';
import { chordProgressions } from '../app/lib/drills/chordProgressions.ts';
import { randomNotes } from '../app/lib/drills/randomNotes.ts';
import { scales } from '../app/lib/drills/scales.ts';
import { resolveConfig } from '../app/lib/drills/fields.ts';
import { fingeredArpeggio, fingeredLine } from '../app/lib/drills/fingering.ts';
import { seededRng } from '../app/lib/drills/random.ts';
import { drills } from '../app/lib/drills/registry.ts';
import { KEY_NAMES, diatonicChord, isWhite, numeral, parseNumerals } from '../app/lib/drills/theory.ts';
import { defaultDuelLayout, duelLayouts, duelOutcome, duelRange, duelSplit } from '../app/lib/duel.ts';
import { DEFAULT_TOLERANCE_MS, Matcher, WaitGate, expectedNotes, scoreByTag, scoreRun } from '../app/lib/scoring.ts';
import { upgradeRun } from '../app/lib/sources.ts';
import {
  addDays,
  analyzeRun,
  dailyTrend,
  dayKey,
  duelRecords,
  keyboard,
  progressBySource,
  runMs,
  streaks,
  tagBreakdown,
  totals,
  weakSections,
} from '../app/lib/stats.ts';
import { defaultSettings, resolveSettings } from '../app/lib/settings.ts';
import type { PlayedEvent, Run } from '../app/types.ts';

// Two tracks at 120 bpm in 4/4, 480 ticks per quarter. The second track plays
// C4 and E4 in measure 1 and G4 at the start of measure 2, using running status.
function fixture(): ArrayBuffer {
  const chunk = (id: string, body: number[]) => [
    ...[...id].map((c) => c.charCodeAt(0)),
    (body.length >>> 24) & 0xff,
    (body.length >>> 16) & 0xff,
    (body.length >>> 8) & 0xff,
    body.length & 0xff,
    ...body,
  ];
  const header = chunk('MThd', [0, 1, 0, 2, 0x01, 0xe0]);
  const conductor = chunk('MTrk', [
    ...[0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20],
    ...[0x00, 0xff, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08],
    ...[0x00, 0xff, 0x2f, 0x00],
  ]);
  const right = chunk('MTrk', [
    ...[0x00, 0xff, 0x03, 0x05, ...[...'Right'].map((c) => c.charCodeAt(0))],
    ...[0x00, 0x90, 60, 80],
    ...[0x83, 0x60, 60, 0],
    ...[0x00, 64, 80],
    ...[0x83, 0x60, 64, 0],
    ...[0x87, 0x40, 67, 80],
    ...[0x83, 0x60, 67, 0],
    ...[0x00, 0xff, 0x2f, 0x00],
  ]);
  return new Uint8Array([...header, ...conductor, ...right]).buffer;
}

const song = () => buildSongModel(parseMidi(fixture()));

// A format 1 file with a conductor track holding `meta`, then one track per
// entry in `parts`, each playing quarter notes from the given tick.
function build(meta: number[], parts: { name: string; channel: number; rest: number[]; notes: number; lead?: number[] }[]) {
  const text = (s: string) => [...s].map((c) => c.charCodeAt(0));
  const chunk = (id: string, body: number[]) => [
    ...text(id),
    ...[24, 16, 8, 0].map((shift) => (body.length >>> shift) & 0xff),
    ...body,
  ];
  const end = [0x00, 0xff, 0x2f, 0x00];
  const tracks = parts.map((p) => {
    const body = [0x00, 0xff, 0x03, p.name.length, ...text(p.name), ...(p.lead ?? [])];
    for (let i = 0; i < p.notes; i++) {
      body.push(...(i === 0 ? p.rest : [0x00]), 0x90 | p.channel, 60, 80, 0x83, 0x60, 0x80 | p.channel, 60, 0);
    }
    return chunk('MTrk', [...body, ...end]);
  });
  const header = chunk('MThd', [0, 1, 0, parts.length + 1, 0x01, 0xe0]);
  return new Uint8Array([...header, ...chunk('MTrk', [...meta, ...end]), ...tracks.flat()]).buffer;
}

const run = (overrides: Partial<Run>): Run => ({
  id: 'run',
  source: { kind: 'song', songId: 'song' },
  sourceKey: 'song:song',
  userId: 'user',
  startedAt: 0,
  startMeasure: 0,
  endMeasure: 1,
  tempoRate: 1,
  tracks: [1],
  metronome: false,
  toleranceMs: 150,
  originTime: -2,
  reachedTime: 4.5,
  completed: true,
  events: [],
  ...overrides,
});

const on = (t: number, pitch: number): PlayedEvent => ({ t, pitch, velocity: 80, on: true });

// Timing errors come out of floating point maths, so round before comparing.
const round = (value: unknown): unknown =>
  JSON.parse(JSON.stringify(value, (_, v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v)));

test('builds a song model from a MIDI file', () => {
  const model = song();
  assert.deepEqual(model.tracks, [{ index: 1, name: 'Right', noteCount: 3, percussion: false }]);
  assert.equal(model.bpm, 120);
  assert.deepEqual(model.measures, [
    { index: 0, start: 0, end: 2 },
    { index: 1, start: 2, end: 4 },
  ]);
  assert.deepEqual(
    model.beats.map((b) => [b.time, b.measure, b.downbeat]),
    [
      [0, 0, true],
      [0.5, 0, false],
      [1, 0, false],
      [1.5, 0, false],
      [2, 1, true],
      [2.5, 1, false],
      [3, 1, false],
      [3.5, 1, false],
    ],
  );
  assert.deepEqual(
    model.notes.map((n) => [n.id, n.pitch, n.start, n.duration, n.track, n.measure]),
    [
      [0, 60, 0, 0.5, 1, 0],
      [1, 64, 0.5, 0.5, 1, 0],
      [2, 67, 2, 0.5, 1, 1],
    ],
  );
});

test('rejects files that are not MIDI', () => {
  assert.throws(() => parseMidi(new TextEncoder().encode('hello there').buffer as ArrayBuffer), /Not a MIDI file/);
});

test('scores hits, misses and extras per measure', () => {
  // C4 20 ms late, a stray D4, E4 never played, G4 30 ms early.
  const events = [on(2020, 60), on(2300, 62), on(3970, 67)];
  assert.deepEqual(round(scoreRun(song(), run({ events }))), {
    hits: 2,
    misses: 1,
    extras: 1,
    accuracy: 0.5,
    meanAbsErrorMs: 25,
    meanErrorMs: -5,
    measures: [
      { measure: 0, hits: 1, misses: 1, extras: 1, accuracy: 0.333, meanAbsErrorMs: 20 },
      { measure: 1, hits: 1, misses: 0, extras: 0, accuracy: 1, meanAbsErrorMs: 30 },
    ],
  });
});

test('ignores notes played during the count-in', () => {
  const score = scoreRun(song(), run({ events: [on(500, 60), on(2000, 60)] }));
  assert.equal(score.hits, 1);
  assert.equal(score.extras, 0);
});

test('at half tempo the tolerance stays in real milliseconds and unreached measures are unscored', () => {
  // The count-in lasts 4 real seconds. C4 is 100 ms late (a hit); E4 is 200 ms
  // late (a miss plus an extra). The run is ended before measure 2.
  const events = [on(4100, 60), on(5200, 64)];
  const score = scoreRun(song(), run({ tempoRate: 0.5, reachedTime: 1, completed: false, events }));
  assert.deepEqual(round(score), {
    hits: 1,
    misses: 1,
    extras: 1,
    accuracy: 0.333,
    meanAbsErrorMs: 100,
    meanErrorMs: 100,
    measures: [
      { measure: 0, hits: 1, misses: 1, extras: 1, accuracy: 0.333, meanAbsErrorMs: 100 },
      { measure: 1, hits: 0, misses: 0, extras: 0, accuracy: null, meanAbsErrorMs: null },
    ],
  });
});

test('wouldMatch says whether a note would pair without recording anything', () => {
  const model = song();
  const notes = expectedNotes(model, { tracks: [1], startMeasure: 0, endMeasure: 1 });
  const matcher = new Matcher(notes, DEFAULT_TOLERANCE_MS, 1, 0);
  assert.equal(matcher.wouldMatch(2.1, 67), true);
  assert.equal(matcher.wouldMatch(2.3, 67), false);
  assert.equal(matcher.wouldMatch(2.1, 60), false);
  assert.equal(matcher.matched.size, 0);
  assert.equal(matcher.extras.length, 0);
  matcher.noteOn(2.1, 67);
  assert.equal(matcher.wouldMatch(2.05, 67), false);
});

// Plays events through the live wait-mode clock, as the practice canvas does.
function playWaiting(events: PlayedEvent[], endAt: number, tempoRate = 1) {
  const model = song();
  const notes = expectedNotes(model, { tracks: [1], startMeasure: 0, endMeasure: 1 });
  const originTime = -2 * tempoRate;
  const matcher = new Matcher(notes, DEFAULT_TOLERANCE_MS, tempoRate, 0);
  const gate = new WaitGate(notes, matcher, originTime, tempoRate);
  for (const e of events) {
    matcher.noteOn(gate.songTime(e.t), e.pitch);
    gate.update(e.t);
  }
  const reachedTime = gate.songTime(endAt);
  gate.update(endAt, true);
  return { matcher, gate, reachedTime, originTime };
}

test('wait mode holds the song at each note until it is played', () => {
  // C4 on time. The clock reaches E4 at 2500 ms and stands still; a stray D4
  // is played while waiting, then E4 at 3500 ms releases it. G4 is on time on
  // the delayed clock.
  const events = [on(2000, 60), on(3000, 62), on(3500, 64), on(5000, 67)];
  const live = playWaiting(events, 6000);
  assert.deepEqual(round(live.gate.holds), [{ at: 0.5, ms: 1000 }]);
  assert.equal(live.matcher.matched.size, 3);
  assert.equal(round(live.reachedTime), 3);

  const score = scoreRun(song(), run({ wait: true, holds: live.gate.holds, reachedTime: live.reachedTime, events }));
  assert.deepEqual(
    [score.hits, score.misses, score.extras],
    [live.matcher.matched.size, 0, live.matcher.extras.length],
  );
  assert.equal(score.extras, 1);
});

test('wait mode records the hold the run ended in', () => {
  // C4 is played, then the player gives up while the song waits on E4.
  const live = playWaiting([on(2000, 60)], 4000);
  assert.deepEqual(round(live.gate.holds), [{ at: 0.5, ms: 1500 }]);
  assert.equal(live.reachedTime, 0.5);
  const score = scoreRun(
    song(),
    run({ wait: true, holds: live.gate.holds, reachedTime: live.reachedTime, completed: false, events: [on(2000, 60)] }),
  );
  assert.deepEqual([score.hits, score.misses, score.extras], [1, 0, 0]);
});

test('skips system exclusive messages without losing its place', () => {
  // Synth reset messages like this one sit at the top of many downloaded files.
  const sysex = [0x00, 0xf0, 0x05, 0x7e, 0x7f, 0x09, 0x01, 0xf7];
  const model = buildSongModel(parseMidi(build([], [{ name: 'Piano', channel: 0, rest: [0x00], notes: 2, lead: sysex }])));
  assert.deepEqual(
    model.notes.map((n) => n.start),
    [0, 0.5],
  );
  assert.equal(model.measures.length, 1);
});

test('a time signature change partway through a measure starts a new one', () => {
  // 4/4, then 3/4 from the third beat of the first measure.
  const meta = [0x00, 0xff, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08, 0x87, 0x40, 0xff, 0x58, 0x04, 0x03, 0x02, 0x18, 0x08];
  const model = buildSongModel(parseMidi(build(meta, [{ name: 'Piano', channel: 0, rest: [0x00], notes: 5 }])));
  assert.deepEqual(
    model.measures.map((m) => [m.start, m.end]),
    [
      [0, 1],
      [1, 2.5],
    ],
  );
  assert.deepEqual(
    model.beats.map((b) => [b.time, b.downbeat]),
    [
      [0, true],
      [0.5, false],
      [1, true],
      [1.5, false],
      [2, false],
    ],
  );
  assert.deepEqual(
    model.notes.map((n) => n.measure),
    [0, 0, 1, 1, 1],
  );
});

test('default settings pick the piano part and trim the silence around it', () => {
  // Drums play from the start; the piano comes in at measure 3 (0x9e 0x00 is 3840 ticks).
  const model = buildSongModel(
    parseMidi(
      build([], [
        { name: 'Drums', channel: 9, rest: [0x00], notes: 16 },
        { name: 'Strings', channel: 1, rest: [0x00], notes: 12 },
        { name: 'A.PIANO 2', channel: 0, rest: [0x9e, 0x00], notes: 4 },
      ]),
    ),
  );
  assert.deepEqual(
    model.tracks.map((t) => t.percussion),
    [true, false, false],
  );
  assert.deepEqual(defaultSettings(model), { tracks: [3], tempoRate: 1, firstMeasure: 2, lastMeasure: 2 });
  // Stored settings are kept, but can't point outside the piece.
  assert.deepEqual(resolveSettings(model, { tracks: [3, 7], tempoRate: 0.8, firstMeasure: 1, lastMeasure: 99 }), {
    tracks: [3],
    tempoRate: 0.8,
    firstMeasure: 1,
    lastMeasure: 3,
  });
});

test('writeMidi output reads back as the same events', () => {
  const tracks = [
    [
      { tick: 0, type: 'tempo', usPerQuarter: 750000 },
      { tick: 0, type: 'timeSig', numerator: 3, denominator: 4 },
    ],
    [
      { tick: 0, type: 'trackName', name: 'Right' },
      // A long gap needs a multi-byte delta, and E4 repeats at the tick it ends.
      ...noteEvents([
        { pitch: 64, tick: 20000, duration: 480 },
        { pitch: 64, tick: 20480, duration: 480, velocity: 100, channel: 2 },
        { pitch: 60, tick: 0, duration: 480 },
      ]),
    ],
  ] as const;
  const file = parseMidi(writeMidi({ ticksPerQuarter: 480, tracks: tracks.map((t) => [...t]) }).buffer as ArrayBuffer);
  assert.equal(file.format, 1);
  assert.equal(file.ticksPerQuarter, 480);
  assert.deepEqual(file.tracks[0], tracks[0]);
  assert.deepEqual(file.tracks[1], [
    { tick: 0, type: 'trackName', name: 'Right' },
    { tick: 0, type: 'noteOn', channel: 0, pitch: 60, velocity: 80 },
    { tick: 480, type: 'noteOff', channel: 0, pitch: 60 },
    { tick: 20000, type: 'noteOn', channel: 0, pitch: 64, velocity: 80 },
    { tick: 20480, type: 'noteOff', channel: 0, pitch: 64 },
    { tick: 20480, type: 'noteOn', channel: 2, pitch: 64, velocity: 100 },
    { tick: 20960, type: 'noteOff', channel: 2, pitch: 64 },
  ]);
  const model = buildSongModel(file);
  assert.equal(model.notes.length, 3);
});

test('scoreByTag totals each measure label', () => {
  const score = scoreRun(song(), run({ events: [on(2000, 60), on(2500, 64)] }));
  const groups = scoreByTag(score, [{ key: 'C major' }, { key: 'C major' }]);
  assert.deepEqual(groups, [{ tag: 'key', values: [{ value: 'C major', hits: 2, misses: 1, extras: 0, accuracy: 2 / 3 }] }]);
});

test('upgradeRun turns a run that named a song into one with a source', () => {
  const { source, sourceKey, ...rest } = run({});
  const upgraded = upgradeRun({ ...rest, songId: 'abc' });
  assert.deepEqual(upgraded.source, { kind: 'song', songId: 'abc' });
  assert.equal(upgraded.sourceKey, 'song:abc');
  assert.equal('songId' in upgraded, false);
  assert.deepEqual(upgradeRun({ ...rest, source, sourceKey }), run({}));
});

test('resolveConfig falls back to defaults and keeps the order keys were picked in', () => {
  const resolved = resolveConfig(chordProgressions, { keys: ['F', 'nope', 'C', 'F'], size: 'ninths', custom: 4 });
  assert.deepEqual(resolved.keys, ['F', 'C']);
  assert.equal(resolved.size, 'triads');
  assert.equal(resolved.custom, '');
  assert.deepEqual(resolveConfig(chordProgressions, { keys: [] }).keys, chordProgressions.defaults.keys);
});

test('every built-in preset of every drill generates a consistent exercise', () => {
  for (const drill of drills) {
    for (const preset of drill.presets) {
      const config = resolveConfig(drill, preset.config);
      const exercise = drill.generate(config, seededRng(7));
      const label = `${drill.id}/${preset.id}`;
      assert.ok(exercise.notes.length > 0, label);
      assert.equal(exercise.tags.length, exercise.measures.length, label);
      const tracks = new Set(exercise.tracks.map((t) => t.index));
      for (const n of exercise.notes) {
        assert.ok(tracks.has(n.track), label);
        const m = exercise.measures[n.measure];
        assert.ok(n.start >= m.start && n.start < m.end, label);
      }
      assert.deepEqual(drill.generate(config, seededRng(7)), exercise, `${label} is not repeatable`);
      assert.ok(drill.summary(config), label);
    }
  }
});

test('the chord drill voices its first chords as the old script did', () => {
  const exercise = chordProgressions.generate(resolveConfig(chordProgressions, chordProgressions.presets[0].config), seededRng(1));
  const measure = (i: number) => exercise.notes.filter((n) => n.measure === i).map((n) => n.pitch);
  assert.deepEqual(measure(0), [48, 60, 64, 67]); // C: root in the left hand, C E G
  assert.deepEqual(measure(1), [41, 60, 65, 69]); // F, the nearest inversion
  assert.deepEqual(exercise.tags[4], { key: 'C major', chord: 'ii' });
  assert.equal(exercise.measures.length, 40);
});

test('minor keys raise the leading tone on V, and sevenths are named', () => {
  assert.deepEqual(diatonicChord(9, 'minor', 5, 3), [4, 8, 11]); // E major in A minor
  assert.equal(numeral(5, diatonicChord(9, 'minor', 5, 3)), 'V');
  assert.equal(numeral(2, diatonicChord(0, 'major', 2, 4)), 'ii7');
  assert.equal(numeral(7, diatonicChord(0, 'major', 7, 4)), 'viiø7');
  assert.deepEqual(parseNumerals('I – vi, ii7 V x'), [1, 6, 2, 5]);
});

test('random key order changes with the seed but not without it', () => {
  const config = resolveConfig(chordProgressions, { keys: [...KEY_NAMES], order: 'random', progressions: ['ii-V-I'] });
  const keys = (seed: number) => chordProgressions.generate(config, seededRng(seed)).tags.map((t) => t.key).join();
  assert.equal(keys(1), keys(1));
  assert.notEqual(keys(1), keys(2));
});

const rightHand = (exercise: { notes: { track: number; pitch: number }[] }) =>
  exercise.notes.filter((n) => n.track === 0).map((n) => n.pitch);

test('melodic minor goes up with raised 6th and 7th and comes down natural', () => {
  const config = resolveConfig(scales, { keys: ['A'], scales: ['melodic-minor'], octaves: 1, direction: 'up-down' });
  assert.deepEqual(rightHand(scales.generate(config, seededRng(1))), [69, 71, 72, 74, 76, 78, 80, 81, 79, 77, 76, 74, 72, 71, 69]);
});

test('contrary motion moves the hands apart from an octave and back', () => {
  const config = resolveConfig(scales, { keys: ['C'], octaves: 1, motion: 'contrary' });
  const exercise = scales.generate(config, seededRng(1));
  const left = exercise.notes.filter((n) => n.track === 1).map((n) => n.pitch);
  assert.deepEqual(left, [48, 47, 45, 43, 41, 40, 38, 36, 38, 40, 41, 43, 45, 47, 48]);
  assert.equal(rightHand(exercise)[7], 72);
});

test('triplet runs land in the right measures and the last note fills its measure', () => {
  const config = resolveConfig(scales, { keys: ['C'], octaves: 2, direction: 'up', value: 'triplet' });
  const exercise = scales.generate(config, seededRng(1));
  // 15 notes of a third of a beat: 12 fill measure 1, 3 start measure 2.
  assert.deepEqual(exercise.notes.filter((n) => n.track === 0).map((n) => n.measure), [...Array(12).fill(0), 1, 1, 1]);
  const last = exercise.notes.filter((n) => n.track === 0).at(-1)!;
  assert.equal(Math.round((last.start + last.duration) * 1000), Math.round(exercise.measures[1].end * 1000));
});

test('arpeggio inversions start on the right chord tone', () => {
  const config = resolveConfig(arpeggios, { keys: ['C'], chords: ['major'], inversion: 'first', octaves: 1, direction: 'up' });
  assert.deepEqual(rightHand(arpeggios.generate(config, seededRng(1))), [64, 67, 72, 76]);
  const all = resolveConfig(arpeggios, { keys: ['C'], chords: ['dominant7'], inversion: 'all', octaves: 1 });
  assert.deepEqual([...new Set(arpeggios.generate(all, seededRng(1)).tags.map((t) => t.inversion))], [
    'root position',
    '1st inversion',
    '2nd inversion',
    '3rd inversion',
  ]);
});

test('random notes stay in range, on white keys and within the largest jump', () => {
  const config = resolveConfig(randomNotes, { low: '60', high: '72', whiteOnly: true, size: '1', maxJump: 4, count: 40 });
  const pitches = randomNotes.generate(config, seededRng(5)).notes.map((n) => n.pitch);
  assert.equal(pitches.length, 40);
  assert.ok(pitches.every((p) => p >= 60 && p <= 72 && isWhite(p)));
  assert.ok(pitches.slice(1).every((p, i) => Math.abs(p - pitches[i]) <= 4));
});

test('random triads are major or minor and named for their root', () => {
  const config = resolveConfig(randomNotes, { size: '3', low: '55', high: '79', whiteOnly: false, count: 30 });
  const exercise = randomNotes.generate(config, seededRng(9));
  for (const [i, tag] of exercise.tags.entries()) {
    const pcs = exercise.notes.filter((n) => n.measure === i).map((n) => n.pitch % 12);
    const root = KEY_NAMES.indexOf(tag.chord.split(' ')[0].replace('♭', 'b').replace('♯', '#'));
    const third = tag.chord.endsWith('major') ? 4 : 3;
    assert.deepEqual(new Set(pcs), new Set([root, (root + third) % 12, (root + 7) % 12]), tag.chord);
  }
});

test('scales are fingered the standard way in every major and harmonic minor key', () => {
  const MAJOR = [0, 2, 4, 5, 7, 9, 11];
  const HARMONIC = [0, 2, 3, 5, 7, 8, 11];
  const fingers = (key: string, steps: number[], hand: 'right' | 'left') =>
    fingeredLine((hand === 'right' ? 60 : 48) + KEY_NAMES.indexOf(key), 1, steps, steps, 'up', hand)
      .map((n) => n.finger)
      .join('');
  // One octave up from the tonic, right hand then left.
  const major: Record<string, [string, string]> = {
    C: ['12312345', '54321321'], G: ['12312345', '54321321'], D: ['12312345', '54321321'],
    A: ['12312345', '54321321'], E: ['12312345', '54321321'], B: ['12312345', '43214321'],
    'F#': ['23412312', '43213214'], Db: ['23123412', '32143213'], Ab: ['34123123', '32143213'],
    Eb: ['31234123', '32143213'], Bb: ['41231234', '32143213'], F: ['12341234', '54321321'],
  };
  const minor: Record<string, [string, string]> = {
    A: ['12312345', '54321321'], E: ['12312345', '54321321'], B: ['12312345', '43214321'],
    'F#': ['34123123', '43213214'], Db: ['34123123', '32143213'], Ab: ['34123123', '32143213'],
    Eb: ['31234123', '21432132'], Bb: ['41231234', '21321432'], F: ['12341234', '54321321'],
    C: ['12312345', '54321321'], G: ['12312345', '54321321'], D: ['12312345', '54321321'],
  };
  for (const [key, [right, left]] of Object.entries(major)) {
    assert.equal(fingers(key, MAJOR, 'right'), right, `${key} major right hand`);
    assert.equal(fingers(key, MAJOR, 'left'), left, `${key} major left hand`);
  }
  for (const [key, [right, left]] of Object.entries(minor)) {
    assert.equal(fingers(key, HARMONIC, 'right'), right, `${key} harmonic minor right hand`);
    assert.equal(fingers(key, HARMONIC, 'left'), left, `${key} harmonic minor left hand`);
  }
});

test('the scales drill puts a finger on every note, turning at the top on the fifth finger', () => {
  const config = resolveConfig(scales, { keys: ['C'], octaves: 2, direction: 'up-down' });
  const exercise = scales.generate(config, seededRng(1));
  const right = exercise.notes.filter((n) => n.track === 0).map((n) => n.annotation).join('');
  assert.equal(right, '12312341231234543213214321321');
  assert.ok(exercise.notes.every((n) => n.annotation));
});

test('chromatic scales keep the thumb on white keys and 3 on black', () => {
  const chromatic = Array.from({ length: 12 }, (_, i) => i);
  const run = (hand: 'right' | 'left') =>
    fingeredLine(60, 1, chromatic, chromatic, 'up', hand).map((n) => n.finger).join('');
  assert.equal(run('right'), '1313123131312');
  assert.equal(run('left'), '1313213131321');
});

test('arpeggios are fingered the standard way in every major and minor key', () => {
  const fingers = (key: string, steps: number[], hand: 'right' | 'left') =>
    fingeredArpeggio((hand === 'right' ? 60 : 48) + KEY_NAMES.indexOf(key), 2, steps, 'up', hand)
      .map((n) => n.finger)
      .join('');
  // Two octaves up from the root, right hand then left.
  const major: Record<string, [string, string]> = {
    C: ['1231235', '5421421'], G: ['1231235', '5421421'], F: ['1231235', '5421421'],
    D: ['1231235', '5321321'], A: ['1231235', '5321321'], E: ['1231235', '5321321'], B: ['1231235', '5321321'],
    Db: ['4124124', '2142142'], Ab: ['4124124', '2142142'], Eb: ['4124124', '2142142'], Bb: ['4124124', '3213213'],
    'F#': ['1231235', '5421421'],
  };
  const minor: Record<string, [string, string]> = {
    C: ['1231235', '5421421'], D: ['1231235', '5421421'], E: ['1231235', '5421421'], F: ['1231235', '5421421'],
    G: ['1231235', '5421421'], A: ['1231235', '5421421'], B: ['1231235', '5421421'],
    Db: ['4124124', '2132132'], 'F#': ['4124124', '2132132'], Ab: ['4124124', '2132132'], Bb: ['2312312', '3213213'],
    Eb: ['1231235', '5421421'],
  };
  for (const [key, [right, left]] of Object.entries(major)) {
    assert.equal(fingers(key, [0, 4, 7], 'right'), right, `${key} major right hand`);
    assert.equal(fingers(key, [0, 4, 7], 'left'), left, `${key} major left hand`);
  }
  for (const [key, [right, left]] of Object.entries(minor)) {
    assert.equal(fingers(key, [0, 3, 7], 'right'), right, `${key} minor right hand`);
    assert.equal(fingers(key, [0, 3, 7], 'left'), left, `${key} minor left hand`);
  }
  // C major's inversions, and its sevenths.
  assert.equal(fingers('C', [0, 3, 8], 'right') + ' ' + fingers('C', [0, 3, 8], 'left'), '1241245 5421421');
  assert.equal(fingers('G', [0, 5, 9], 'right') + ' ' + fingers('G', [0, 5, 9], 'left'), '1241245 5321321');
  assert.equal(fingers('C', [0, 4, 7, 10], 'right') + ' ' + fingers('C', [0, 4, 7, 10], 'left'), '123412345 543214321');
});

test('the arpeggios drill puts a finger on every note, turning at the top on the fifth finger', () => {
  const config = resolveConfig(arpeggios, { keys: ['C'], chords: ['major'], octaves: 2, direction: 'up-down' });
  const exercise = arpeggios.generate(config, seededRng(1));
  const right = exercise.notes.filter((n) => n.track === 0).map((n) => n.annotation).join('');
  assert.equal(right, '1231235321321');
  assert.ok(exercise.notes.every((n) => n.annotation));
});

test('a duel puts the part twice on the keyboard, whole octaves apart without sharing a key', () => {
  // C4 to G4 fits in an octave, so the copies go one octave apart.
  const pitches = [60, 64, 67];
  const layouts = duelLayouts(pitches);
  assert.ok(layouts.every((l) => l.high - l.low === 12));
  assert.ok(layouts.every((l) => 60 + l.low >= 21 && 67 + l.high <= 108));
  assert.deepEqual(defaultDuelLayout(layouts), { low: -12, high: 0 });
  assert.equal(duelRange(pitches, -12), 'C3–G3');
  // Keys up to the gap's middle belong to the low end.
  assert.equal(duelSplit(pitches, { low: -12, high: 0 }), 58);
  // An octave and a bit needs two octaves between the copies; five octaves can't fit twice.
  assert.ok(duelLayouts([60, 74]).every((l) => l.high - l.low === 24));
  assert.deepEqual(duelLayouts([36, 96]), []);
});

test('a duel run is scored against the part moved into its octaves', () => {
  const score = scoreRun(song(), run({ transpose: -12, events: [on(2000, 48), on(2000, 60), on(4000, 55)] }));
  // C3 and G3 hit; C4 is where the part is written, so for this player it is a wrong note.
  assert.equal(score.hits, 2);
  assert.equal(score.extras, 1);
  assert.equal(expectedNotes(song(), run({ transpose: 12 }))[0].pitch, 72);
});

test('a duel is won on accuracy, then hits, then timing', () => {
  const score = (accuracy: number | null, hits: number, meanAbsErrorMs: number | null) =>
    ({ accuracy, hits, misses: 0, extras: 0, meanAbsErrorMs, meanErrorMs: null, measures: [] });
  assert.deepEqual(duelOutcome(score(0.9, 9, 30), score(0.8, 10, 10)), { winner: 0, by: 'accuracy' });
  assert.deepEqual(duelOutcome(score(0.9, 9, 30), score(0.9, 10, 40)), { winner: 1, by: 'hits' });
  assert.deepEqual(duelOutcome(score(0.9, 9, 30), score(0.9, 9, 20)), { winner: 1, by: 'timing' });
  assert.deepEqual(duelOutcome(score(null, 0, null), score(null, 0, null)), { winner: null, by: null });
});

test('a run lasts its song time at its tempo plus its holds', () => {
  assert.equal(runMs(run({})), 6500);
  assert.equal(runMs(run({ tempoRate: 0.5, holds: [{ at: 0, ms: 700 }] })), 13700);
});

test('analyzeRun tallies each key: hits, misses and wrong presses', () => {
  // As in the scoring test: C4 hit, a stray D4, E4 missed, G4 hit.
  const stats = analyzeRun(song(), run({ events: [on(2020, 60), on(2300, 62), on(3970, 67)] }));
  assert.equal(stats.score.accuracy, 0.5);
  assert.deepEqual(
    stats.keys.sort((a, b) => a.pitch - b.pitch),
    [
      { pitch: 60, hits: 1, misses: 0, wrong: 0 },
      { pitch: 62, hits: 0, misses: 0, wrong: 1 },
      { pitch: 64, hits: 0, misses: 1, wrong: 0 },
      { pitch: 67, hits: 1, misses: 0, wrong: 0 },
    ],
  );
  // Twice over, the keys add up.
  assert.deepEqual(keyboard([stats, stats])[0], { pitch: 60, hits: 2, misses: 0, wrong: 0 });
});

test('streaks count days in a row, and today without practice yet keeps the streak alive', () => {
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  const days = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-10', '2026-10-11'];
  assert.deepEqual(streaks(days, '2026-10-12'), { current: 2, longest: 3 });
  assert.deepEqual(streaks(days, '2026-10-11'), { current: 2, longest: 3 });
  assert.deepEqual(streaks(days, '2026-10-13'), { current: 0, longest: 3 });
  assert.deepEqual(streaks([], '2026-10-13'), { current: 0, longest: 0 });
});

const at = (day: number, hour = 12) => new Date(2026, 9, day, hour).getTime();

test('totals and the daily trend weigh runs by notes, and leave wait mode out of timing', () => {
  const model = song();
  const all = [
    analyzeRun(model, run({ startedAt: at(1, 9), events: [on(2020, 60), on(2300, 62), on(3970, 67)] })),
    analyzeRun(model, run({ startedAt: at(1, 20), events: [on(2000, 60), on(2500, 64), on(4000, 67)] })),
    analyzeRun(
      model,
      run({ startedAt: at(3), wait: true, holds: [{ at: 0, ms: 300 }], events: [on(2300, 60), on(2800, 64), on(4300, 67)] }),
    ),
  ];
  const t = totals(all);
  assert.deepEqual(round({ ...t, ms: undefined }), round({
    runs: 3,
    days: 2,
    hits: 8,
    misses: 1,
    extras: 1,
    accuracy: 0.8,
    meanErrorMs: -2,
    meanAbsErrorMs: 10,
    waitPerNoteMs: 100,
  }));
  assert.deepEqual(
    round(dailyTrend(all)),
    [
      { day: dayKey(at(1)), runs: 2, accuracy: 0.714, meanAbsErrorMs: 10 },
      { day: dayKey(at(3)), runs: 1, accuracy: 1, meanAbsErrorMs: null },
    ],
  );
});

test('progress by source finds the best run, the change and the fastest clean run', () => {
  const model = song();
  // Song times and pitches, played at each run's own tempo.
  const clean = [[0, 60], [0.5, 64], [2, 67]];
  const sloppy = [[0, 60], [0.3, 62]];
  const all = [sloppy, sloppy, clean, clean].map((notes, i) => {
    const tempoRate = 1 + i / 10;
    const events = notes.map(([time, pitch]) => on(((time + 2) / tempoRate) * 1000, pitch));
    return analyzeRun(model, run({ id: `r${i}`, startedAt: at(i + 1), tempoRate, events }));
  });
  const [progress] = progressBySource(all);
  assert.equal(progress.runs, 4);
  assert.equal(progress.best, 1);
  assert.equal(progress.fastestClean?.id, 'r3');
  assert.equal(progress.lastPlayed, at(4));
  // Sloppy runs hit C4 of three notes and press a stray D4: 25%. The first three average 50%, the last three 75%.
  assert.equal(progress.change, 0.25);
});

test('weak sections join neighbouring measures that went badly lately', () => {
  const model = song();
  // Measure 1 is missed twice, then played well three times: only its last five plays count.
  const played = [on(2000, 60), on(2500, 64), on(4000, 67)];
  const first = [on(2000, 60), on(2500, 64)];
  const all = [first, first, played, played, played].map((events) => analyzeRun(model, run({ events })));
  assert.deepEqual(weakSections(all, [0, 1]), [{ from: 1, to: 1, accuracy: 0.6, notes: 5 }]);
  assert.deepEqual(weakSections(all, [0, 0]), []);
  // Two more good plays push both misses out.
  const better = analyzeRun(model, run({ events: played }));
  assert.deepEqual(weakSections([...all, better, better], [0, 1]), []);
});

test('the tag breakdown adds up every run of a drill, weakest first', () => {
  const exercise = { ...song(), tags: [{ key: 'C' }, { key: 'G' }] };
  const source = { kind: 'drill' as const, drillId: 'd', drillVersion: 1, config: {}, seed: 1, exercise };
  const missG = analyzeRun(exercise, run({ source, events: [on(2000, 60), on(2500, 64)] }));
  const all = analyzeRun(exercise, run({ source, events: [on(2000, 60), on(2500, 64), on(4000, 67)] }));
  assert.deepEqual(tagBreakdown([missG, all]), [
    {
      tag: 'key',
      values: [
        { value: 'G', hits: 1, misses: 1, extras: 0, accuracy: 0.5 },
        { value: 'C', hits: 4, misses: 0, extras: 0, accuracy: 1 },
      ],
    },
  ]);
});

test('duel records count wins, losses and draws against each opponent', () => {
  const model = song();
  const side = (id: string, userId: string, opponentId: string, events: PlayedEvent[]) =>
    analyzeRun(model, run({ userId, duel: { id, opponentId, side: 'low' }, events }));
  const good = [on(2000, 60), on(2500, 64), on(4000, 67)];
  const bad = [on(2000, 60)];
  const mine = [side('a', 'me', 'sam', good), side('b', 'me', 'sam', bad), side('c', 'me', 'sam', good), side('d', 'me', 'kim', good)];
  const theirs = [side('a', 'sam', 'me', bad), side('b', 'sam', 'me', good), side('c', 'sam', 'me', good)];
  assert.deepEqual(duelRecords(mine, theirs), [{ opponentId: 'sam', wins: 1, losses: 1, draws: 1 }]);
});
