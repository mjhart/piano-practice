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

## Other commands

```
npm test        # unit tests for MIDI parsing and scoring
npm run lint
npm run build   # static site in out/
```

## Writing MIDI files

`app/lib/midi/write.ts` writes Standard MIDI Files from the same events the
parser reads, so drills can be generated in code. `npm run chord-drill` writes
`sample-midis/chord-drill.mid` (or the path after `--`): I-IV-V-I and ii-V-I-I
in C, G, F, D and Bb, one chord per measure, triads in the right hand and roots
in the left. Edit the constants at the top of `scripts/chord-drill.ts` to
change keys, progressions or tempo.

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
