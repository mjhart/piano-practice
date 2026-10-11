import type { Beat, Exercise, Measure, Note, TrackInfo } from '../../types';

/**
 * The tempo every drill is written at. A beat is one second, and the tempo
 * control sets the rate: 90 bpm is a rate of 1.5.
 */
export const REFERENCE_BPM = 60;

/** A note in beats from the start of the exercise. `part` indexes the parts list. */
export type BeatNote = { part: number; pitch: number; beat: number; beats: number; velocity?: number };

type Spec = {
  /** Part names, such as ['Right hand', 'Left hand']. Each becomes a track. */
  parts: string[];
  beatsPerMeasure: number;
  notes: BeatNote[];
  /** Labels for each measure; there are as many measures as entries. */
  tags: Record<string, string>[];
};

const SECONDS_PER_BEAT = 60 / REFERENCE_BPM;

/** Lays notes written in beats out in seconds, as `buildSongModel` does for a MIDI file. */
export function buildExercise({ parts, beatsPerMeasure, notes, tags }: Spec): Exercise {
  const measures: Measure[] = tags.map((_, index) => ({
    index,
    start: index * beatsPerMeasure * SECONDS_PER_BEAT,
    end: (index + 1) * beatsPerMeasure * SECONDS_PER_BEAT,
  }));
  const beats: Beat[] = measures.flatMap((m) =>
    Array.from({ length: beatsPerMeasure }, (_, i) => ({
      time: m.start + i * SECONDS_PER_BEAT,
      measure: m.index,
      downbeat: i === 0,
    })),
  );
  const sorted = [...notes].sort((a, b) => a.beat - b.beat || a.pitch - b.pitch);
  const built: Note[] = sorted.map((n, id) => ({
    id,
    pitch: n.pitch,
    velocity: n.velocity ?? 80,
    start: n.beat * SECONDS_PER_BEAT,
    duration: n.beats * SECONDS_PER_BEAT,
    track: n.part,
    // Triplets add up to a whole beat only roughly, so allow a hair of rounding.
    measure: Math.min(Math.floor(n.beat / beatsPerMeasure + 1e-9), measures.length - 1),
  }));
  const tracks: TrackInfo[] = parts.map((name, index) => ({
    index,
    name,
    noteCount: built.filter((n) => n.track === index).length,
    percussion: false,
  }));
  return { notes: built, beats, measures, tracks, bpm: REFERENCE_BPM, tags };
}
