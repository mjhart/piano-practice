// Plain, JSON-shaped data shared across the app. Song, User, DrillPreset and
// Run are what the store persists; if a backend is added later these become the wire types.

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
  /** Shown on the note as it falls, such as the finger to play it with. Only drills add these. */
  annotation?: string;
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

/**
 * What a drill generates: a song model like the one a MIDI file becomes, plus
 * labels for each measure (for example { key: 'Bb major', chord: 'ii' }) that
 * results can group by.
 */
export type Exercise = SongModel & {
  /** One entry per measure, by measure index. */
  tags: Record<string, string>[];
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

/** A drill's settings, as plain values a settings form can edit. */
export type DrillConfig = Record<string, string | number | boolean | string[]>;

/** Named drill settings. Shared by every user, like songs. */
export type DrillPreset = {
  id: string;
  drillId: string;
  name: string;
  config: DrillConfig;
  addedAt: number;
};

/** What a run played: an uploaded piece, or an exercise a drill generated. */
export type RunSource =
  | { kind: 'song'; songId: string }
  | {
      kind: 'drill';
      drillId: string;
      /** The drill's version when it generated the exercise. */
      drillVersion: number;
      /** The preset it started from, if any. The settings may have been changed since. */
      presetId?: string;
      config: DrillConfig;
      seed: number;
      /**
       * The exercise as generated, so the run can be scored even after the
       * drill's code changes. Played events are matched against this.
       */
      exercise: Exercise;
    };

export type Duel = {
  /** Shared by the two runs of one duel. */
  id: string;
  /** Who played the other side. */
  opponentId: string;
  /** Which end of the keyboard this player had. */
  side: 'low' | 'high';
};

export type Run = {
  id: string;
  source: RunSource;
  /** 'song:<id>' or 'drill:<drillId>' (see app/lib/sources.ts), indexed for history. */
  sourceKey: string;
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
  /**
   * Semitones every expected note was moved, so a duel player could play the
   * part in their own octaves. Absent means as written.
   */
  transpose?: number;
  /** Set on both runs of a duel: two players at one keyboard, each in their own octaves. */
  duel?: Duel;
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
