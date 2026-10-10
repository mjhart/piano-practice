export type Click = {
  /** When the click should be heard, on the performance.now() clock. */
  perfTime: number;
  downbeat: boolean;
  /** Count-in clicks sound even when the metronome is switched off. */
  countIn: boolean;
};

const TICK_MS = 25;
const LOOKAHEAD_MS = 120;

/**
 * Plays clicks at exact times. Timers are too jittery to fire clicks directly,
 * so a loop wakes every few milliseconds and schedules the upcoming clicks on
 * the audio clock.
 */
export class Metronome {
  enabled: boolean;
  private ctx: AudioContext;
  private clicks: Click[];
  private offsetMs: number;
  private next = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  /** offsetMs plays every click that much earlier, to cancel out audio latency. */
  constructor(clicks: Click[], enabled: boolean, offsetMs: number) {
    this.ctx = new AudioContext();
    this.clicks = clicks;
    this.enabled = enabled;
    this.offsetMs = offsetMs;
  }

  start() {
    void this.ctx.resume();
    this.timer = setInterval(() => this.schedule(), TICK_MS);
    this.schedule();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    void this.ctx.close();
  }

  private schedule() {
    // Pair up the two clocks: the sample at contextTime is heard at performanceTime.
    const stamp = this.ctx.getOutputTimestamp();
    const paired = !!stamp.performanceTime && stamp.contextTime !== undefined;
    const basePerf = paired ? stamp.performanceTime! : performance.now();
    const baseCtx = paired ? stamp.contextTime! : this.ctx.currentTime;
    // Audio already handed to the device can't be changed, so look further
    // ahead when the output latency is large (Bluetooth, for example).
    const latencyMs = Math.max(0, (this.ctx.currentTime - baseCtx) * 1000);
    const horizon = performance.now() + LOOKAHEAD_MS + latencyMs;

    while (this.next < this.clicks.length) {
      const click = this.clicks[this.next];
      const perfTime = click.perfTime - this.offsetMs;
      if (perfTime > horizon) break;
      this.next++;
      if (!click.countIn && !this.enabled) continue;
      const at = baseCtx + (perfTime - basePerf) / 1000;
      if (at < this.ctx.currentTime - 0.05) continue;
      this.play(Math.max(at, this.ctx.currentTime), click.downbeat);
    }
  }

  private play(at: number, downbeat: boolean) {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.frequency.value = downbeat ? 1568 : 1047;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(downbeat ? 0.6 : 0.35, at + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(at);
    osc.stop(at + 0.06);
  }
}
