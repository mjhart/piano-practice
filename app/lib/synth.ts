import type { Note } from '../types';

const TICK_MS = 25;
const LOOKAHEAD_SEC = 0.15;
/** Real seconds between pressing play and the first note, so it is never clipped. */
const LEAD_SEC = 0.08;

/**
 * Plays notes through a plain built-in synth so a part can be auditioned. Like
 * the metronome, a loop wakes every few milliseconds and schedules the
 * upcoming notes on the audio clock.
 */
export class NotePlayer {
  private ctx: AudioContext;
  private out: AudioNode;
  private noise: AudioBuffer;
  private notes: Note[];
  private drums: Set<number>;
  private from: number;
  private to: number;
  private rate: number;
  private onEnd: () => void;
  private startCtx: number;
  private next = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  /**
   * Plays the notes (in start order) that begin between the song times `from`
   * and `to`. Notes on a track in `drums` are played as percussion.
   */
  constructor(notes: Note[], drums: Set<number>, from: number, to: number, rate: number, onEnd: () => void) {
    this.ctx = new AudioContext();
    this.notes = notes;
    this.drums = drums;
    this.from = from;
    this.to = to;
    this.rate = rate;
    this.onEnd = onEnd;
    while (this.next < notes.length && notes[this.next].start < from) this.next++;

    const compressor = this.ctx.createDynamicsCompressor();
    const master = this.ctx.createGain();
    master.gain.value = 0.5;
    master.connect(compressor).connect(this.ctx.destination);
    this.out = master;

    this.noise = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.2, this.ctx.sampleRate);
    const samples = this.noise.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;

    void this.ctx.resume();
    this.startCtx = this.ctx.currentTime + LEAD_SEC;
    this.timer = setInterval(() => this.schedule(), TICK_MS);
    this.schedule();
  }

  /** The song time being heard now. */
  position(): number {
    return Math.min(this.to, this.from + Math.max(0, this.ctx.currentTime - this.startCtx) * this.rate);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.ctx.state !== 'closed') void this.ctx.close();
  }

  private schedule() {
    const horizon = this.from + (this.ctx.currentTime + LOOKAHEAD_SEC - this.startCtx) * this.rate;
    while (this.next < this.notes.length) {
      const n = this.notes[this.next];
      if (n.start >= this.to || n.start > horizon) break;
      this.next++;
      const at = Math.max(this.startCtx + (n.start - this.from) / this.rate, this.ctx.currentTime);
      if (this.drums.has(n.track)) this.drum(at, n);
      else this.tone(at, n);
    }
    if (this.position() >= this.to) {
      this.stop();
      this.onEnd();
    }
  }

  private tone(at: number, n: Note) {
    const length = Math.min(Math.max(n.duration / this.rate, 0.08), 6);
    const peak = 0.05 + 0.3 * (n.velocity / 127) ** 1.5;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = 440 * 2 ** ((n.pitch - 69) / 12);
    // A struck-string shape: fast attack, then a slow fade while the key is held.
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(peak, at + 0.008);
    gain.gain.exponentialRampToValueAtTime(Math.max(peak * 0.25 ** Math.min(length, 2), 0.0002), at + length);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + length + 0.12);
    osc.connect(gain).connect(this.out);
    osc.start(at);
    osc.stop(at + length + 0.14);
  }

  private drum(at: number, n: Note) {
    const peak = 0.1 + 0.4 * (n.velocity / 127);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(peak, at);
    gain.connect(this.out);
    if (n.pitch <= 36) {
      // Bass drum: a low thump that drops in pitch.
      const osc = this.ctx.createOscillator();
      osc.frequency.setValueAtTime(140, at);
      osc.frequency.exponentialRampToValueAtTime(45, at + 0.12);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.2);
      osc.connect(gain);
      osc.start(at);
      osc.stop(at + 0.22);
    } else {
      // Everything else is a burst of noise, brighter and shorter for cymbals.
      const cymbal = n.pitch >= 42 && n.pitch !== 43 && n.pitch !== 45 && n.pitch !== 47;
      const source = this.ctx.createBufferSource();
      const filter = this.ctx.createBiquadFilter();
      source.buffer = this.noise;
      filter.type = cymbal ? 'highpass' : 'bandpass';
      filter.frequency.value = cymbal ? 7000 : 1800;
      gain.gain.setValueAtTime(peak * (cymbal ? 0.4 : 0.8), at);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + (cymbal ? 0.06 : 0.14));
      source.connect(filter).connect(gain);
      source.start(at);
      source.stop(at + 0.2);
    }
  }
}
