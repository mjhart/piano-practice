import type { Beat, Measure, Note, SongModel, TrackInfo } from '../../types';
import type { MidiFile } from './parse';

type RawNote = { part: number; channel: number; pitch: number; velocity: number; startTick: number; endTick: number };

// General MIDI keeps channel 10 for drums, where pitches pick the drum.
const DRUM_CHANNEL = 9;

// Index of the last entry whose key is <= value (0 if none).
function lastAtOrBefore<T>(items: T[], key: (item: T) => number, value: number): number {
  let lo = 0;
  let hi = items.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (key(items[mid]) <= value) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * Flattens a parsed MIDI file into notes, beats and measures, all in seconds
 * at the file's own tempo. Everything downstream works from this.
 */
export function buildSongModel(file: MidiFile): SongModel {
  const tpq = file.ticksPerQuarter;
  const tempos: { tick: number; usPerQuarter: number }[] = [];
  const timeSigs: { tick: number; numerator: number; denominator: number }[] = [];
  const names = new Map<number, string>();
  const raw: RawNote[] = [];
  let lastTick = 0;

  file.tracks.forEach((events, trackIndex) => {
    const open = new Map<number, RawNote[]>();
    for (const e of events) {
      if (e.type === 'tempo') tempos.push(e);
      else if (e.type === 'timeSig') timeSigs.push(e);
      else if (e.type === 'trackName') names.set(trackIndex, e.name);
      else {
        // A format 0 file has one track, so its parts are told apart by channel.
        const part = file.format === 0 ? e.channel : trackIndex;
        const key = e.channel * 128 + e.pitch;
        if (e.type === 'noteOn') {
          const note = { part, channel: e.channel, pitch: e.pitch, velocity: e.velocity, startTick: e.tick, endTick: -1 };
          raw.push(note);
          open.set(key, [...(open.get(key) ?? []), note]);
          lastTick = Math.max(lastTick, e.tick + 1);
        } else {
          const note = open.get(key)?.shift();
          if (note) note.endTick = e.tick;
          lastTick = Math.max(lastTick, e.tick);
        }
      }
    }
  });
  if (raw.length === 0) throw new Error('This MIDI file has no notes');
  for (const note of raw) if (note.endTick < 0) note.endTick = lastTick;

  // Tempo map: each segment records the second at which it begins.
  tempos.sort((a, b) => a.tick - b.tick);
  const segments = [{ tick: 0, sec: 0, usPerQuarter: 500000 }];
  for (const t of tempos) {
    const prev = segments[segments.length - 1];
    if (t.tick === prev.tick) prev.usPerQuarter = t.usPerQuarter;
    else {
      const sec = prev.sec + ((t.tick - prev.tick) * prev.usPerQuarter) / 1e6 / tpq;
      segments.push({ tick: t.tick, sec, usPerQuarter: t.usPerQuarter });
    }
  }
  const tickToSec = (tick: number) => {
    const seg = segments[lastAtOrBefore(segments, (s) => s.tick, tick)];
    return seg.sec + ((tick - seg.tick) * seg.usPerQuarter) / 1e6 / tpq;
  };

  // Measures and beats, following time signature changes.
  timeSigs.sort((a, b) => a.tick - b.tick);
  const measures: Measure[] = [];
  const measureTicks: number[] = [];
  const beats: Beat[] = [];
  let numerator = 4;
  let denominator = 4;
  let nextSig = 0;
  for (let tick = 0; tick < lastTick; ) {
    while (nextSig < timeSigs.length && timeSigs[nextSig].tick <= tick) {
      ({ numerator, denominator } = timeSigs[nextSig++]);
    }
    const beatTicks = (tpq * 4) / denominator;
    const index = measures.length;
    // A time signature change starts a new measure, even partway through one.
    const change = nextSig < timeSigs.length ? timeSigs[nextSig].tick : Infinity;
    const end = Math.min(tick + beatTicks * numerator, change);
    for (let t = tick; t < end; t += beatTicks) {
      beats.push({ time: tickToSec(t), measure: index, downbeat: t === tick });
    }
    measureTicks.push(tick);
    measures.push({ index, start: tickToSec(tick), end: tickToSec(end) });
    tick = end;
  }

  raw.sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch);
  const notes: Note[] = raw.map((n, id) => {
    const start = tickToSec(n.startTick);
    return {
      id,
      pitch: n.pitch,
      velocity: n.velocity,
      start,
      duration: tickToSec(n.endTick) - start,
      track: n.part,
      measure: lastAtOrBefore(measureTicks, (t) => t, n.startTick),
    };
  });

  const counts = new Map<number, number>();
  const pitched = new Set<number>();
  for (const n of raw) {
    counts.set(n.part, (counts.get(n.part) ?? 0) + 1);
    if (n.channel !== DRUM_CHANNEL) pitched.add(n.part);
  }
  const tracks: TrackInfo[] = [...counts.keys()]
    .sort((a, b) => a - b)
    .map((index) => ({
      index,
      name: file.format === 0 ? `Channel ${index + 1}` : names.get(index) || `Track ${index + 1}`,
      noteCount: counts.get(index) ?? 0,
      percussion: !pitched.has(index),
    }));

  return { notes, beats, measures, tracks, bpm: 60e6 / segments[0].usPerQuarter };
}
