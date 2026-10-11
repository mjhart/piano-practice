// A small Standard MIDI File writer, the inverse of `parseMidi`. It writes the
// same events the parser keeps, so a file can be built in code and read back.

import type { MidiEvent, MidiFile } from './parse';

export type NoteSpec = { pitch: number; tick: number; duration: number; velocity?: number; channel?: number };

/** Turns notes with a start and a length into note on and note off events. */
export function noteEvents(notes: NoteSpec[]): MidiEvent[] {
  return notes.flatMap(({ pitch, tick, duration, velocity = 80, channel = 0 }): MidiEvent[] => [
    { tick, type: 'noteOn', channel, pitch, velocity },
    { tick: tick + duration, type: 'noteOff', channel, pitch },
  ]);
}

// At the same tick, meta events go first and note offs before note ons, so a
// note that repeats straight away ends before it starts again.
const ORDER: Record<MidiEvent['type'], number> = { trackName: 0, tempo: 1, timeSig: 2, noteOff: 3, noteOn: 4 };

/** Encodes a format 1 file. Each track's events may be in any order. */
export function writeMidi(file: Pick<MidiFile, 'ticksPerQuarter' | 'tracks'>): Uint8Array {
  const out: number[] = [];
  const u16 = (v: number) => out.push((v >> 8) & 0xff, v & 0xff);
  const u32 = (v: number) => out.push((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff);
  const ascii = (s: string) => out.push(...[...s].map((c) => c.charCodeAt(0)));
  const varLen = (v: number) => {
    const bytes = [v & 0x7f];
    while ((v >>>= 7)) bytes.unshift((v & 0x7f) | 0x80);
    out.push(...bytes);
  };

  ascii('MThd');
  u32(6);
  u16(1);
  u16(file.tracks.length);
  u16(file.ticksPerQuarter);

  for (const events of file.tracks) {
    ascii('MTrk');
    const lengthAt = out.length;
    u32(0);
    const sorted = events
      .map((e, i) => ({ e, i }))
      .sort((a, b) => a.e.tick - b.e.tick || ORDER[a.e.type] - ORDER[b.e.type] || a.i - b.i)
      .map(({ e }) => e);
    let tick = 0;
    for (const e of sorted) {
      if (e.tick < 0 || !Number.isInteger(e.tick)) throw new Error(`Bad tick ${e.tick}`);
      varLen(e.tick - tick);
      tick = e.tick;
      if (e.type === 'noteOn') out.push(0x90 | e.channel, e.pitch, e.velocity);
      else if (e.type === 'noteOff') out.push(0x80 | e.channel, e.pitch, 0x40);
      else if (e.type === 'tempo') {
        out.push(0xff, 0x51, 0x03, (e.usPerQuarter >> 16) & 0xff, (e.usPerQuarter >> 8) & 0xff, e.usPerQuarter & 0xff);
      } else if (e.type === 'timeSig') {
        out.push(0xff, 0x58, 0x04, e.numerator, Math.log2(e.denominator), 24, 8);
      } else {
        const bytes = [...new TextEncoder().encode(e.name)];
        out.push(0xff, 0x03);
        varLen(bytes.length);
        out.push(...bytes);
      }
    }
    out.push(0x00, 0xff, 0x2f, 0x00);
    const length = out.length - lengthAt - 4;
    out.splice(lengthAt, 4, (length >>> 24) & 0xff, (length >>> 16) & 0xff, (length >>> 8) & 0xff, length & 0xff);
  }
  return new Uint8Array(out);
}
