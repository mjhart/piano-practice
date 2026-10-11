import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseMidi } from '../app/lib/midi/parse.ts';
import { buildSongModel } from '../app/lib/midi/songModel.ts';
import { DEFAULT_TOLERANCE_MS, Matcher, WaitGate, expectedNotes, scoreRun } from '../app/lib/scoring.ts';
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
  songId: 'song',
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
