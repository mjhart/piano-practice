import type { SongModel, SongSettings } from '../types';

export const MIN_TEMPO_RATE = 0.3;
export const MAX_TEMPO_RATE = 1.5;

/** First and last measures holding a note from any of the given parts. */
export function measureSpan(song: SongModel, tracks: number[]): [number, number] {
  const wanted = new Set(tracks);
  let first = -1;
  let last = -1;
  for (const n of song.notes) {
    if (!wanted.has(n.track)) continue;
    if (first < 0) first = n.measure;
    last = Math.max(last, n.measure);
  }
  return first < 0 ? [0, song.measures.length - 1] : [first, last];
}

/**
 * A starting guess for a newly added piece: the part most likely to be the
 * piano, at the file's tempo, without the empty measures around it.
 */
export function defaultSettings(song: SongModel): SongSettings {
  const playable = song.tracks.filter((t) => !t.percussion);
  const candidates = playable.length ? playable : song.tracks;
  const named = candidates.filter((t) => /piano|keys|keyboard|klavier/i.test(t.name));
  const pool = named.length ? named : candidates;
  const pick = pool.reduce((a, b) => (b.noteCount > a.noteCount ? b : a));
  const [firstMeasure, lastMeasure] = measureSpan(song, [pick.index]);
  return { tracks: [pick.index], tempoRate: 1, firstMeasure, lastMeasure };
}

/** Stored settings made safe to use against the model they are applied to. */
export function resolveSettings(song: SongModel, stored: SongSettings | undefined): SongSettings {
  if (!stored) return defaultSettings(song);
  const known = new Set(song.tracks.map((t) => t.index));
  const max = song.measures.length - 1;
  const clamp = (value: number, lo: number, hi: number) => Math.min(Math.max(value, lo), hi);
  const firstMeasure = clamp(Math.round(stored.firstMeasure) || 0, 0, max);
  return {
    tracks: stored.tracks.filter((t) => known.has(t)),
    tempoRate: clamp(stored.tempoRate || 1, MIN_TEMPO_RATE, MAX_TEMPO_RATE),
    firstMeasure,
    lastMeasure: clamp(Math.round(stored.lastMeasure) || 0, firstMeasure, max),
  };
}
