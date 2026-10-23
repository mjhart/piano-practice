import { line } from './common.ts';
import { isWhite } from './theory.ts';

// Scale fingerings, worked out from where the black keys fall rather than
// looked up, so every scale in every key gets one. The rules give the
// standard fingerings for the major and harmonic minor scales: the thumb never
// plays a black key and crosses beside one where it can, and a scale that
// starts on a white key keeps the thumb on its tonic, as C, G, D, A and E
// major do.

export type Hand = 'right' | 'left';

/** Group sizes from the tonic up, in order of preference when two fingerings cost the same. */
const PATTERNS: Record<Hand, number[][]> = {
  // 1 2 3, 1 2 3 4 in the right hand; 4 3 2 1, 3 2 1 in the left.
  right: [[3, 4], [4, 3], [3, 3], [3, 2], [2, 3], [4, 2], [2, 4], [4, 4], [3], [4], [2]],
  left: [[4, 3], [3, 4], [3, 3], [2, 3], [3, 2], [2, 4], [4, 2], [4, 4], [3], [4], [2]],
};

/** A thumb on a black key: only when a scale has too few white keys to avoid it. */
const BLACK_THUMB = 10;

/**
 * The finger (thumb is 1) for each step of a scale, given as semitones up from
 * the tonic, as it goes up and repeats every octave. `tonicFinger` asks for a
 * finger on the tonic, so a scale that comes down by other steps (melodic
 * minor) turns around on the finger it went up with.
 */
export function scaleFingers(tonic: number, steps: number[], hand: Hand, tonicFinger?: number): number[] {
  const n = steps.length;
  const white = steps.map((s) => isWhite(tonic + s));
  // The note after a step going up, and the one before it.
  const next = (i: number) => (i + 1) % n;
  const prev = (i: number) => (i + n - 1) % n;

  if (n === 12) {
    // Chromatic: thumb on the white keys and 3 on the black, with 2 on the
    // second of two white keys in a row going up in the right hand, and on the
    // first in the left.
    return steps.map((_, i) => (!white[i] ? 3 : white[hand === 'right' ? prev(i) : next(i)] ? 2 : 1));
  }

  let best: number[] = [];
  let bestCost = Infinity;
  for (const pattern of PATTERNS[hand]) {
    for (let start = 0; start < n; start++) {
      // Split the octave into groups from `start`; each must fit exactly.
      const sizes: number[] = [];
      for (let total = 0; total < n; total += sizes.at(-1)!) sizes.push(pattern[sizes.length % pattern.length]);
      if (sizes.reduce((a, b) => a + b) !== n) continue;
      const fingers = new Array<number>(n);
      let cost = 0;
      let at = start;
      for (const size of sizes) {
        // Right hand groups start on the thumb going up; left hand groups end on it.
        for (let k = 0; k < size; k++) fingers[(at + k) % n] = hand === 'right' ? k + 1 : size - k;
        const thumb = hand === 'right' ? at % n : (at + size - 1) % n;
        if (!white[thumb]) cost += BLACK_THUMB;
        // Every crossing costs something; one beside a black key is easier than one between white keys.
        cost += 1 + (white[hand === 'right' ? prev(thumb) : next(thumb)] ? 1 : 0);
        // A group of two crosses twice as often.
        if (size < 3) cost += 1;
        at += size;
      }
      if (tonicFinger !== undefined ? fingers[0] !== tonicFinger : white[0] && fingers[0] !== 1) cost += 3;
      if (cost < bestCost) {
        bestCost = cost;
        best = fingers;
      }
    }
  }
  return best;
}

/**
 * Pitches and fingers for a run, built as `line` builds it: up with the `up`
 * steps and down with the `down` steps. The repeating fingering applies
 * throughout, except that the top note in the right hand and the bottom note
 * in the left take the next finger in place of the thumb, as C major ends
 * … 3 4 5.
 */
export function fingeredLine(
  bottom: number,
  octaves: number,
  up: number[],
  down: number[],
  direction: string,
  hand: Hand,
): { pitch: number; finger: number }[] {
  const tonic = bottom % 12;
  const pitches = line(bottom, octaves, up, down, direction);
  const top = bottom + 12 * octaves;
  const fingersFor = (steps: number[], tonicFinger?: number) => {
    const fingers = scaleFingers(tonic, steps, hand, tonicFinger);
    return (pitch: number) => fingers[steps.indexOf((pitch - bottom) % 12)];
  };
  const rising = fingersFor(up);
  const falling = up.join() === down.join() ? rising : fingersFor(down, rising(bottom));
  // Chromatic runs keep the thumb on white keys at both ends.
  if (up.length === 12) return pitches.map((pitch) => ({ pitch, finger: isWhite(pitch) && (pitch === (hand === 'right' ? bottom : top)) ? 1 : rising(pitch) }));
  // The step beside the end where the thumb has nowhere to go, in the steps used to reach it.
  const endFinger = (steps: number[], at: (pitch: number) => number) => {
    if (hand === 'right') return at(top) === 1 ? at(top - 12 + steps.at(-1)!) + 1 : at(top);
    return at(bottom) === 1 ? at(bottom + steps[1]) + 1 : at(bottom);
  };
  return pitches.map((pitch, i) => {
    // Going up into this note or out of it uses the rising steps.
    const goingUp = (pitches[i + 1] ?? -Infinity) > pitch || (pitches[i - 1] ?? Infinity) < pitch;
    const steps = goingUp ? up : down;
    const at = goingUp ? rising : falling;
    const end = hand === 'right' ? top : bottom;
    return { pitch, finger: pitch === end ? endFinger(steps, at) : at(pitch) };
  });
}

// Arpeggio fingerings, worked out the same way. Each octave repeats one hand
// position: the right hand plays 1 2 3 or 1 2 4 up from the thumb (1 2 3 4 for
// a seventh chord) and the left hand 3 2 1 or 4 2 1 up to it (4 3 2 1). The
// thumb takes the lowest note when it is white, as in C, D and A major, and
// otherwise a white key it crosses beside a black one, as B♭ major puts it on
// D in the right hand and on F in the left. Only when every note is black does
// the thumb go on one, and then on the lowest, as in C.

/** How far across the keyboard a pitch is, in white keys, with a black key between its neighbours. */
const keyPosition = (pitch: number) => 7 * Math.floor(pitch / 12) + [0, 0.5, 1, 1.5, 2, 3, 3.5, 4, 4.5, 5, 5.5, 6][pitch % 12];

/**
 * The finger for each note of a chord broken upwards from `bottom`, given as
 * semitones up from it, as it repeats every octave.
 */
export function arpeggioFingers(bottom: number, steps: number[], hand: Hand): number[] {
  const n = steps.length;
  const pitch = (i: number) => bottom + steps[i % n] + 12 * Math.floor(i / n);
  const white = steps.map((s) => isWhite(bottom + s));
  let thumb = 0;
  let bestCost = Infinity;
  for (let t = 0; t < n; t++) {
    // The note the thumb crosses from going up in the right hand, or to in the left.
    const beside = hand === 'right' ? (t + n - 1) % n : (t + 1) % n;
    const cost = (white[t] ? 0 : BLACK_THUMB) + (white[beside] ? 1 : 0) + (white[0] && t !== 0 ? 3 : 0);
    if (cost < bestCost) {
      bestCost = cost;
      thumb = t;
    }
  }
  const fingers = new Array<number>(n);
  for (let k = 0; k < n; k++) fingers[(thumb + k) % n] = hand === 'right' ? k + 1 : k === 0 ? 1 : n + 1 - k;
  if (n === 3) {
    if (hand === 'right') {
      // The third note takes 4 when it is further from the second than from
      // the next thumb, as C major's first inversion goes 1 2 4; otherwise 3,
      // and the thumb crosses the wider gap.
      const third = thumb + 2;
      fingers[third % n] = pitch(third) - pitch(third - 1) > pitch(third + 1) - pitch(third) ? 4 : 3;
    } else {
      // The note after the thumb takes 3 a fourth away, or a major third away
      // on a black key, as D major goes 5 3 2 1; otherwise 4, as C major goes 5 4 2 1.
      const next = thumb + 1;
      fingers[next % n] = keyPosition(pitch(next)) - keyPosition(pitch(thumb)) >= 2.5 ? 3 : 4;
    }
  }
  return fingers;
}

/**
 * Pitches and fingers for an arpeggio, built as `line` builds it, the same
 * steps up and down. The top note in the right hand and the bottom note in the
 * left take 5 where the pattern would put the thumb.
 */
export function fingeredArpeggio(
  bottom: number,
  octaves: number,
  steps: number[],
  direction: string,
  hand: Hand,
): { pitch: number; finger: number }[] {
  const fingers = arpeggioFingers(bottom, steps, hand);
  const end = hand === 'right' ? bottom + 12 * octaves : bottom;
  return line(bottom, octaves, steps, steps, direction).map((pitch) => {
    const finger = fingers[steps.indexOf((pitch - bottom) % 12)];
    return { pitch, finger: pitch === end && finger === 1 ? 5 : finger };
  });
}
