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

## Other commands

```
npm test        # unit tests for MIDI parsing and scoring
npm run lint
npm run build   # static site in out/
```

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
