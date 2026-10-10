// A small Standard MIDI File reader. It keeps only the events the app uses
// (notes, tempo, time signature, track names) and skips everything else.

export type MidiEvent =
  | { tick: number; type: 'noteOn'; channel: number; pitch: number; velocity: number }
  | { tick: number; type: 'noteOff'; channel: number; pitch: number }
  | { tick: number; type: 'tempo'; usPerQuarter: number }
  | { tick: number; type: 'timeSig'; numerator: number; denominator: number }
  | { tick: number; type: 'trackName'; name: string };

export type MidiFile = {
  format: number;
  ticksPerQuarter: number;
  tracks: MidiEvent[][];
};

export function parseMidi(buffer: ArrayBuffer): MidiFile {
  const view = new DataView(buffer);
  let pos = 0;

  const u8 = () => view.getUint8(pos++);
  const u16 = () => {
    const v = view.getUint16(pos);
    pos += 2;
    return v;
  };
  const u32 = () => {
    const v = view.getUint32(pos);
    pos += 4;
    return v;
  };
  const text = (length: number) => {
    let s = '';
    for (let i = 0; i < length; i++) s += String.fromCharCode(u8());
    return s;
  };
  const varLen = () => {
    let v = 0;
    for (;;) {
      const b = u8();
      v = (v << 7) | (b & 0x7f);
      if (!(b & 0x80)) return v;
    }
  };

  const readTrack = (end: number): MidiEvent[] => {
    const events: MidiEvent[] = [];
    let tick = 0;
    let running = 0;
    while (pos < end) {
      tick += varLen();
      let status = u8();
      if (status < 0x80) {
        // Running status: this byte is data for the previous channel message.
        if (!running) throw new Error('Corrupt MIDI track');
        pos--;
        status = running;
      } else if (status < 0xf0) {
        running = status;
      }

      if (status === 0xff) {
        const meta = u8();
        const length = varLen();
        const next = pos + length;
        if (meta === 0x51 && length === 3) {
          events.push({ tick, type: 'tempo', usPerQuarter: (u8() << 16) | (u8() << 8) | u8() });
        } else if (meta === 0x58 && length >= 2) {
          const numerator = u8();
          const denominator = 2 ** u8();
          if (numerator > 0) events.push({ tick, type: 'timeSig', numerator, denominator });
        } else if (meta === 0x03) {
          events.push({ tick, type: 'trackName', name: text(length).trim() });
        }
        pos = next;
      } else if (status === 0xf0 || status === 0xf7) {
        pos += varLen();
      } else {
        const kind = status & 0xf0;
        const channel = status & 0x0f;
        const a = u8();
        const b = kind === 0xc0 || kind === 0xd0 ? 0 : u8();
        if (kind === 0x90 && b > 0) {
          events.push({ tick, type: 'noteOn', channel, pitch: a, velocity: b });
        } else if (kind === 0x80 || kind === 0x90) {
          events.push({ tick, type: 'noteOff', channel, pitch: a });
        }
      }
    }
    return events;
  };

  try {
    if (text(4) !== 'MThd') throw new Error('Not a MIDI file');
    const headerLength = u32();
    const format = u16();
    u16(); // track count; the chunks themselves are the source of truth
    const division = u16();
    if (division & 0x8000) throw new Error('SMPTE-timed MIDI files are not supported');
    pos = 8 + headerLength;

    const tracks: MidiEvent[][] = [];
    while (pos + 8 <= view.byteLength) {
      const id = text(4);
      const length = u32();
      const end = Math.min(pos + length, view.byteLength);
      if (id === 'MTrk') tracks.push(readTrack(end));
      pos = end;
    }
    return { format, ticksPerQuarter: division, tracks };
  } catch (e) {
    if (e instanceof RangeError) throw new Error('MIDI file is truncated');
    throw e;
  }
}
