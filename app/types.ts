// Plain, JSON-shaped data shared across the app. Song, User and Run are what
// the store persists; if a backend is added later these become the wire types.

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
  /** A drum part: its pitches choose drums, so it can't be played on a piano. */
  percussion: boolean;
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

/** How a piece is set up for practice. Chosen once after upload, editable later. */
export type SongSettings = {
  /** The parts ticked when the piece is opened. */
  tracks: number[];
  /** The tempo the piece opens at. 1 is the file's tempo. */
  tempoRate: number;
  /**
   * Inclusive measure indexes. Measures outside are hidden, but keep their
   * numbers, so runs recorded before a trim still line up.
   */
  firstMeasure: number;
  lastMeasure: number;
};

export type Song = {
  id: string;
  title: string;
  midi: ArrayBuffer;
  addedAt: number;
  /** Missing on pieces added before settings existed; see resolveSettings. */
  settings?: SongSettings;
};

export type SongSummary = Omit<Song, 'midi'>;

/** Someone who practises on this device. Songs are shared; runs belong to one user. */
export type User = {
  id: string;
  name: string;
  addedAt: number;
};

export type PlayedEvent = {
  /** Real milliseconds since the run's clock started. */
  t: number;
  pitch: number;
  velocity: number;
  on: boolean;
};

/** A place where wait mode stopped the song until the right notes were played. */
export type Hold = {
  /** Song time the song stopped at. */
  at: number;
  /** Real milliseconds it stayed there. */
  ms: number;
};

export type Run = {
  id: string;
  songId: string;
  /** Who played it. Runs recorded before there were users belong to the first user. */
  userId: string;
  startedAt: number;
  /** Inclusive measure indexes. A full play-through covers every measure. */
  startMeasure: number;
  endMeasure: number;
  /** 1 is the file's tempo, 0.5 is half speed. */
  tempoRate: number;
  tracks: number[];
  metronome: boolean;
  /** Wait mode: the song stopped at each note until it was played. Absent on older runs. */
  wait?: boolean;
  /** Where wait mode stopped the song, in order. */
  holds?: Hold[];
  /**
   * Which pass this was, from 1, when the section was looped. Each pass is its
   * own run. Absent when the section was played once.
   */
  pass?: number;
  toleranceMs: number;
  /**
   * Song time at t = 0, so songTime = originTime + (t / 1000) * tempoRate,
   * except that the clock stands still during holds.
   */
  originTime: number;
  /** Song time when the run stopped. */
  reachedTime: number;
  completed: boolean;
  events: PlayedEvent[];
};
