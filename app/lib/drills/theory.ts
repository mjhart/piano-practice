// Keys, scales and chords, shared by the drills. Pitches are MIDI note numbers
// (middle C is 60); pitch classes run 0 to 11 from C.

export const KEY_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

/** Sharps read better than flats for these minor keys. */
const MINOR_NAMES: Record<string, string> = { Db: 'C#', Ab: 'G#' };

export type Mode = 'major' | 'minor';

export const tonicOf = (key: string) => KEY_NAMES.indexOf(key);

export const keyLabel = (key: string, mode: Mode) =>
  `${(mode === 'minor' && MINOR_NAMES[key]) || key} ${mode}`.replace('b ', '♭ ').replace('# ', '♯ ');

/** Keys in the order of the circle of fifths from C, going up (C G D…) or down (C F B♭…). */
export function circleOrder(keys: string[], direction: 'up' | 'down'): string[] {
  const step = direction === 'up' ? 7 : 5;
  const position = (key: string) => {
    for (let i = 0; i < 12; i++) if ((i * step) % 12 === tonicOf(key)) return i;
    return 0;
  };
  return [...keys].sort((a, b) => position(a) - position(b));
}

const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
const NATURAL_MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10];

/**
 * Pitch classes of the diatonic chord on `degree` (1 to 7), a triad or with
 * its seventh. In minor, chords on 5 and 7 take the raised leading tone, as in
 * harmonic minor, so V is major and leads home.
 */
export function diatonicChord(tonic: number, mode: Mode, degree: number, size: 3 | 4): number[] {
  const scale = mode === 'major' ? MAJOR_SCALE : NATURAL_MINOR_SCALE;
  const raise = mode === 'minor' && (degree === 5 || degree === 7);
  return [0, 2, 4, 6].slice(0, size).map((step) => {
    const index = (degree - 1 + step) % 7;
    const interval = scale[index] + (raise && index === 6 ? 1 : 0);
    return (tonic + interval) % 12;
  });
}

const NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

/** Roman numeral for a chord, in capitals when its third is major, with ° for diminished. */
export function numeral(degree: number, chord: number[]): string {
  const third = (chord[1] - chord[0] + 12) % 12;
  const fifth = (chord[2] - chord[0] + 12) % 12;
  const name = NUMERALS[degree - 1];
  const text = third === 4 ? name : name.toLowerCase();
  const halfDiminished = chord.length === 4 && (chord[3] - chord[0] + 12) % 12 === 10;
  const quality = fifth === 6 ? (halfDiminished ? 'ø' : '°') : fifth === 8 ? '+' : '';
  return text + quality + (chord.length === 4 ? '7' : '');
}

/** Scale degrees from Roman numerals such as "ii V I" or "I-vi-IV-V". Anything else is skipped. */
export function parseNumerals(text: string): number[] {
  return text
    .split(/[\s,–—-]+/)
    .map((token) => NUMERALS.indexOf(token.replace(/[^ivIV]/g, '').toUpperCase()) + 1)
    .filter((degree) => degree > 0);
}

/** Every close-position voicing of a chord whose lowest note is from G3 to F#4 and highest at most G5. */
function voicings(pcs: number[]): number[][] {
  const result: number[][] = [];
  for (let inversion = 0; inversion < pcs.length; inversion++) {
    const order = [...pcs.slice(inversion), ...pcs.slice(0, inversion)];
    for (let bass = 55; bass < 67; bass++) {
      if (bass % 12 !== order[0]) continue;
      const pitches = [bass];
      for (const pc of order.slice(1)) {
        let p = pitches[pitches.length - 1] + 1;
        while (p % 12 !== pc) p++;
        pitches.push(p);
      }
      if (pitches[pitches.length - 1] <= 79) result.push(pitches);
    }
  }
  return result;
}

/** Root position nearest middle C. */
export function rootPosition(pcs: number[]): number[] {
  return voice(pcs, null);
}

/** The voicing that moves least from `previous`, or root position nearest middle C. */
export function voice(pcs: number[], previous: number[] | null): number[] {
  const options = voicings(pcs);
  const cost = (v: number[]) =>
    previous && previous.length === v.length
      ? v.reduce((sum, p, i) => sum + Math.abs(p - previous[i]), 0)
      : v[0] % 12 === pcs[0]
        ? Math.abs(v[0] - 60)
        : Infinity;
  return options.reduce((best, v) => (cost(v) < cost(best) || (cost(v) === cost(best) && v[0] < best[0]) ? v : best));
}

/** The chord's root for the left hand, from E2 to D#3. */
export const bassRoot = (pc: number) => 40 + ((pc - 4 + 12) % 12);

const PITCH_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

/** "F♯3", with middle C as C4. */
export const pitchName = (pitch: number) => `${PITCH_NAMES[pitch % 12]}${Math.floor(pitch / 12) - 1}`;

export const isWhite = (pitch: number) => ![1, 3, 6, 8, 10].includes(pitch % 12);
