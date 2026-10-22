# Piano Practice

Practice piano pieces from MIDI files with a MIDI keyboard. Notes fall towards
an on-screen keyboard, the app scores how accurately you played them, and every
run is saved so you can see which measures need work and practice just those.

It runs entirely in the browser. Pieces and practice history are stored in
IndexedDB on this device; use "Download backup" on the library page to keep a
copy.

## Run it

```
npm install
npm run dev
```

Open http://localhost:3000 in Chrome, Edge or Firefox (Safari has no Web MIDI),
plug in a MIDI keyboard and allow MIDI access when asked.

## Adding a piece

Adding a MIDI file opens its setup screen. Tick the parts you will play (they
are drawn as a piano roll and you can listen to them), set the tempo the piece
should open at, and drag the edges of the roll to trim off intros, outros or
empty measures. "Set up" on the library or piece page brings the screen back.

## Players

Several people can practise on the same device. Pick who is playing from the
Player menu at the top of every page; the same menu adds, renames and removes
players. Pieces and their setup are shared, while each player has their own
runs, history and measure colours. Practice recorded before players existed
belongs to the first player, "Player 1".

## Statistics

"Stats" at the top of every page shows the current player's practice: time at
the keys, practice days and streak, a calendar of the last 20 weeks, accuracy
and timing by day, a keyboard coloured by how often each key's notes were hit
(with the keys missed most and pressed by mistake), progress on each piece and
drill, trouble spots in pieces with a button to practice just those measures,
every drill run added up by key or chord, and the player's duel record. It
covers the last 7 days, 30 days or all time, and like scores it is all worked
out from the stored runs.

## Other commands

```
npm test        # unit tests for MIDI parsing and scoring
npm run lint
npm run build   # static site in out/
```

## Drills

Besides uploaded pieces, the library lists built-in drills, each making its
exercise from settings chosen on its page and each with a few presets:

- Chord progressions: keys, progressions (or your own in Roman numerals), major
  or minor, triads or sevenths, voicing and a right-hand pattern.
- Scales: major, the three minors, pentatonics, blues and chromatic, in any keys,
  1 to 4 octaves, hands an octave apart or in contrary motion.
- Arpeggios: major, minor, dominant and diminished sevenths, from any inversion.
- Random notes: notes, intervals or triads at random within a range, one per
  two beats; with "Wait for each note" on it becomes a reading-speed drill.
 "Save these settings" adds your
own preset, shared by every player like pieces are. Drills play and score
exactly like pieces. Measures are labelled (key, chord, scale, note…) and results
show how each label went. Every run is in the player's history for that
drill, whatever settings it used.

To add a drill, write a file in `app/lib/drills/` exporting a `DrillDefinition`
and add it to the list in `app/lib/drills/registry.ts`. `npm test` checks that
every preset of every drill generates a consistent exercise.

## Writing MIDI files

`app/lib/midi/write.ts` writes Standard MIDI Files from the same events the
parser reads. `npm run chord-drill` exports a chord progression drill preset as
`sample-midis/chord-drill.mid` (or `npm run chord-drill -- out.mid [preset-id [bpm]]`),
by default I-IV-V-I and ii-V-I-I in C, G, F, D and Bb at 80 bpm.

## How scoring works

A played note is a hit if it has the right pitch and lands within 150 ms of the
written note, measured in real time whatever the tempo. Written notes with no
match are misses, and played notes with no match are wrong notes. Accuracy is
hits / (hits + misses + wrong notes). Note lengths are not scored.

### Wait mode

Tick "Wait for each note" to have the music stop at every note until you play
it, the way you would when learning a new piece. Wrong notes still count, but
nothing is missed and timing is not scored. The run stores where the music
stopped and for how long, so it is scored on the same clock you played to.
