import type { Run, RunSource } from '../types';

// A run's source key names its history: every run of one song, or every run of
// one drill whatever its settings. The store indexes runs by it.

export const songKey = (songId: string) => `song:${songId}`;
export const drillKey = (drillId: string) => `drill:${drillId}`;

export function sourceKeyOf(source: RunSource): string {
  return source.kind === 'song' ? songKey(source.songId) : drillKey(source.drillId);
}

/** A run as stored by any version: before drills, runs named only a song. */
export type StoredRun = Omit<Run, 'source' | 'sourceKey'> & { source?: RunSource; sourceKey?: string; songId?: string };

/** Brings a stored run up to date. Runs from before drills played a song. */
export function upgradeRun(stored: StoredRun): Run {
  const { songId, ...rest } = stored;
  const source: RunSource = stored.source ?? { kind: 'song', songId: songId ?? '' };
  return { ...rest, source, sourceKey: sourceKeyOf(source) };
}

/** The tempo a run was or will be played at: a percentage of a piece's own tempo, or a drill's bpm. */
export function tempoText(source: RunSource, tempoRate: number): string {
  return source.kind === 'drill'
    ? `${Math.round(source.exercise.bpm * tempoRate)} bpm`
    : `${Math.round(tempoRate * 100)}% tempo`;
}
