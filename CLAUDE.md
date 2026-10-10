# Piano Practice

Next.js 15 static export (no server). See README.md for what it does.

## Commands

- `npm run dev` / `npm run build` / `npm run lint`
- `npm test` runs `test/*.test.ts` with Node's built-in runner and type stripping

## Architecture

- `app/types.ts`: the song model (derived from MIDI, never stored) and the
  stored records `Song` and `Run`.
- `app/lib/midi/`: hand-written Standard MIDI File parser, and `buildSongModel`
  which flattens a file into notes, beats and measures in seconds.
- `app/lib/scoring.ts`: `Matcher` pairs played notes with expected notes. It is
  used live in the canvas and again by `scoreRun`, so the two always agree.
- `app/lib/store/`: `PracticeStore` is the only way to read or write practice
  data. `IndexedDbStore` is the one implementation, chosen in `index.ts`. A
  backend would be a second implementation of the same interface.
- `app/lib/midiInput.ts`: one shared Web MIDI connection.
- `app/lib/metronome.ts`: Web Audio clicks scheduled ahead on the audio clock.
- `app/song/components/PracticeCanvas.tsx`: the practice loop. It owns the
  transport (real time to song time), drives the canvas with
  `requestAnimationFrame`, and builds the `Run` when practice ends.

## Conventions

- Runs store raw played events; scores are always computed from them, never
  stored. Changing the scoring rules must not require a data migration.
- Song time is seconds at the file's own tempo. Tempo choice only changes the
  transport's rate. Timing tolerance and errors are in real milliseconds.
- Files under `app/lib` that the tests import must use only `import type` for
  other modules and no TypeScript-only syntax (enums, parameter properties),
  so Node can run them directly.
- No state, data-fetching or component libraries.
