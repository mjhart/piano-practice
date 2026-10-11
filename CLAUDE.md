# Piano Practice

Next.js 15 static export (no server). See README.md for what it does.

## Commands

- `npm run dev` / `npm run build` / `npm run lint`
- `npm test` runs `test/*.test.ts` with Node's built-in runner and type stripping

## Architecture

- `app/types.ts`: the song model (derived from MIDI, never stored), `Exercise`
  (a drill's generated song model with labels per measure), and the stored
  records `Song`, `User`, `DrillPreset` and `Run`. A run's `source` is a song or
  a drill; a drill run stores the exercise it played, so it can always be scored.
- `app/lib/sources.ts`: source keys (`song:<id>`, `drill:<id>`) that index a
  run's history, and `upgradeRun` for runs stored before drills.
- `app/lib/midi/`: hand-written Standard MIDI File parser, and `buildSongModel`
  which flattens a file into notes, beats and measures in seconds.
- `app/lib/scoring.ts`: `Matcher` pairs played notes with expected notes. It is
  used live in the canvas and again by `scoreRun`, so the two always agree.
- `app/lib/drills/`: built-in drills. Each is a `DrillDefinition` (settings
  fields, defaults, presets, a pure `generate(config, rng)`) listed in
  `registry.ts`. `resolveConfig` makes any settings safe; `theory.ts` and
  `exercise.ts` are shared helpers. Drills write at `REFERENCE_BPM`; the tempo
  control sets the rate.
- `app/lib/store/`: `PracticeStore` is the only way to read or write practice
  data. `IndexedDbStore` is the one implementation, chosen in `index.ts`. A
  backend would be a second implementation of the same interface.
- `app/lib/users.ts`: the user list and current user, shared by every page.
  Songs are shared; each `Run` has a `userId`. Which user is current is a
  per-device pref (`app/lib/prefs.ts`). `UserPicker` in the header switches.
- `app/lib/settings.ts`: `SongSettings` (default parts, default tempo, trim)
  are stored on the `Song`. `resolveSettings` supplies a guess when a piece has
  none and clamps stored ones to the model.
- `app/lib/midiInput.ts`: one shared Web MIDI connection.
- `app/lib/synth.ts`: `NotePlayer`, a Web Audio synth for auditioning parts,
  scheduled ahead like the metronome.
- `app/song/setup/`: the setup screen a piece opens on after upload. It edits
  the title and `SongSettings`, with `TrackPreview` (piano roll, trim handles).
- `app/lib/metronome.ts`: Web Audio clicks scheduled ahead on the audio clock.
- `app/song/components/PracticeSession.tsx`: the setup, practice, results and
  history screens a piece (`app/song/page.tsx`) and a drill (`app/drill/page.tsx`)
  share.
- `app/song/components/PracticeCanvas.tsx`: the practice loop. It owns the
  transport (real time to song time), drives the canvas with
  `requestAnimationFrame`, and builds the `Run` when practice ends.

## Conventions

- Runs store raw played events; scores are always computed from them, never
  stored. Changing the scoring rules must not require a data migration.
- Song time is seconds at the file's own tempo. Tempo choice only changes the
  transport's rate. Timing tolerance and errors are in real milliseconds.
- Trimming hides measures; it never renumbers them. Runs store file measure
  indexes, so they stay valid when the trim changes.
- Files under `app/lib` that the tests import must use only `import type` for
  other modules, or import values with an explicit `.ts` extension (as
  `app/lib/drills/` does), and no TypeScript-only syntax (enums, parameter
  properties), so Node can run them directly.
- Bump a drill's `version` when the same settings and seed would generate
  different notes. Built-in preset ids and drill ids are stored on runs; never
  change them.
- No state, data-fetching or component libraries.
