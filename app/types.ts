// Plain, JSON-shaped data shared across the app. Song and Run are what the
// store persists; if a backend is added later these become the wire types.

// ---- Song model: derived from the MIDI file, never stored ----

export type Note = {
  id: number;
  pitch: number;
  velocity: number;
  /** Seconds from the start of the song at the file's own tempo. */
  start: number;
  duration: number;
  track: number;
  measure: number;
};

export type Beat = {
  time: number;
  measure: number;
  downbeat: boolean;
};

export type Measure = {
  index: number;
  start: number;
  end: number;
};

export type TrackInfo = {
  index: number;
  name: string;
  noteCount: number;
};

export type SongModel = {
  notes: Note[];
  beats: Beat[];
  measures: Measure[];
  tracks: TrackInfo[];
  /** Tempo at the start of the file. */
  bpm: number;
};

// ---- Stored records ----

export type Song = {
  id: string;
  title: string;
  midi: ArrayBuffer;
  addedAt: number;
};

export type SongSummary = Omit<Song, 'midi'>;

export type PlayedEvent = {
  /** Real milliseconds since the run's clock started. */
  t: number;
  pitch: number;
  velocity: number;
  on: boolean;
};

export type Run = {
  id: string;
  songId: string;
  startedAt: number;
  /** Inclusive measure indexes. A full play-through covers every measure. */
  startMeasure: number;
  endMeasure: number;
  /** 1 is the file's tempo, 0.5 is half speed. */
  tempoRate: number;
  tracks: number[];
  metronome: boolean;
  toleranceMs: number;
  /** Song time at t = 0, so songTime = originTime + (t / 1000) * tempoRate. */
  originTime: number;
  /** Song time when the run stopped. */
  reachedTime: number;
  completed: boolean;
  events: PlayedEvent[];
};
