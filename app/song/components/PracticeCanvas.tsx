'use client';

import { useEffect, useRef, useState } from 'react';
import { Metronome, type Click } from '../../lib/metronome';
import { subscribeNotes } from '../../lib/midiInput';
import { getMetronomeOffset } from '../../lib/prefs';
import { DEFAULT_TOLERANCE_MS, Matcher, WaitGate, expectedNotes, songTimeOf } from '../../lib/scoring';
import type { PlayedEvent, Run, SongModel } from '../../types';

export type PracticeConfig = {
  tracks: number[];
  startMeasure: number;
  endMeasure: number;
  tempoRate: number;
  metronome: boolean;
  /** Stop at each note until it is played. */
  wait: boolean;
};

type Props = {
  song: SongModel;
  songId: string;
  config: PracticeConfig;
  onFinish: (run: Run) => void;
  /** The run was ended before the first measure began; nothing is recorded. */
  onCancel: () => void;
};

// Canvas can't read Tailwind classes; these mirror the tokens in globals.css.
const COLOR = {
  night: '#0c0c0d',
  slate: '#1c1b1a',
  rule: '#6b6862',
  snow: '#fbfaf6',
  haze: '#a8a49c',
  ember: '#e0432f',
  flame: '#f07a26',
  gold: '#f9c938',
};
// Parts take the stripe colours. A hit turns solid white and a miss goes hollow,
// so the three states differ by fill as well as by colour.
const TRACK_COLORS = [COLOR.gold, COLOR.ember, COLOR.flame, '#f4a98c'];
const STRIPES = [COLOR.ember, COLOR.flame, COLOR.gold];
// The ridge under the count-in number, as fractions of its stripe block.
const RIDGE = [
  [0, 0.8], [0.1, 0.55], [0.17, 0.72], [0.3, 0.38], [0.4, 0.7], [0.5, 0.58],
  [0.66, 0.2], [0.78, 0.62], [0.86, 0.48], [1, 0.82],
];

/** Real seconds between a note appearing at the top and reaching the keys. */
const FALL_SECONDS = 3;
/** Real milliseconds of quiet before the count-in, so the first click is never clipped. */
const LEAD_MS = 300;

const isBlack = (pitch: number) => [1, 3, 6, 8, 10].includes(pitch % 12);

export function PracticeCanvas({ song, songId, config, onFinish, onCancel }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const positionRef = useRef<HTMLSpanElement>(null);
  const hitsRef = useRef<HTMLSpanElement>(null);
  const metronomeRef = useRef<Metronome | null>(null);
  const endRef = useRef<() => void>(() => {});
  const callbacks = useRef({ onFinish, onCancel });
  const [metronomeOn, setMetronomeOn] = useState(config.metronome);

  useEffect(() => {
    callbacks.current = { onFinish, onCancel };
  });

  useEffect(() => {
    const canvas = canvasRef.current!;
    const g = canvas.getContext('2d')!;
    const rate = config.tempoRate;
    const notes = expectedNotes(song, config);
    const first = song.measures[config.startMeasure];
    const rangeStart = first.start;
    const rangeEnd = song.measures[config.endMeasure].end;
    const tolSec = (DEFAULT_TOLERANCE_MS / 1000) * rate;

    // ---- Transport: one mapping between real time and song time ----
    // The count-in is one measure long, so the song clock starts a measure early.
    const countIn = first.end - first.start;
    const originTime = rangeStart - countIn;
    const startedAtPerf = performance.now() + LEAD_MS;
    const startedAt = Date.now() + LEAD_MS;
    const matcher = new Matcher(notes, DEFAULT_TOLERANCE_MS, rate, rangeStart);
    // In wait mode the clock stops at each note until the matcher pairs it.
    const gate = config.wait ? new WaitGate(notes, matcher, originTime, rate) : null;
    const songTimeAt = (perf: number) =>
      gate ? gate.songTime(perf - startedAtPerf) : songTimeOf({ originTime, tempoRate: rate }, perf - startedAtPerf);
    const perfTimeAt = (songTime: number) => startedAtPerf + ((songTime - originTime) / rate) * 1000;
    // Keep going a moment past the last measure so a late final note still counts.
    const stopAt = rangeEnd + tolSec + 0.4 * rate;

    // ---- Metronome ----
    // Clicks are scheduled ahead on a steady clock, so wait mode keeps only the count-in.
    const rangeBeats = song.beats.filter((b) => b.measure >= config.startMeasure && b.measure <= config.endMeasure);
    const countInBeats = rangeBeats.filter((b) => b.measure === config.startMeasure);
    const clicks: Click[] = [
      ...countInBeats.map((b) => ({ perfTime: perfTimeAt(b.time - countIn), downbeat: b.downbeat, countIn: true })),
      ...(gate ? [] : rangeBeats.map((b) => ({ perfTime: perfTimeAt(b.time), downbeat: b.downbeat, countIn: false }))),
    ];
    const metronome = new Metronome(clicks, config.metronome && !gate, getMetronomeOffset());
    metronomeRef.current = metronome;
    metronome.start();

    // ---- Input and live matching ----
    const events: PlayedEvent[] = [];
    const held = new Set<number>();
    const unsubscribe = subscribeNotes((e) => {
      if (e.on) held.add(e.pitch);
      else held.delete(e.pitch);
      const t = e.timeStamp - startedAtPerf;
      if (t < 0) return;
      events.push({ t, pitch: e.pitch, velocity: e.velocity, on: e.on });
      if (!e.on) return;
      matcher.noteOn(songTimeAt(e.timeStamp), e.pitch);
      gate?.update(t);
    });

    let finished = false;
    const finish = (completed: boolean) => {
      if (finished) return;
      finished = true;
      const now = performance.now();
      const reachedTime = songTimeAt(now);
      gate?.update(now - startedAtPerf, true);
      if (reachedTime <= rangeStart) {
        callbacks.current.onCancel();
        return;
      }
      callbacks.current.onFinish({
        id: crypto.randomUUID(),
        songId,
        startedAt,
        startMeasure: config.startMeasure,
        endMeasure: config.endMeasure,
        tempoRate: rate,
        tracks: config.tracks,
        metronome: config.metronome && !gate,
        ...(gate && { wait: true, holds: gate.holds }),
        toleranceMs: DEFAULT_TOLERANCE_MS,
        originTime,
        reachedTime,
        completed,
        events,
      });
    };
    endRef.current = () => finish(false);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish(false);
    };
    window.addEventListener('keydown', onKeyDown);

    // ---- Keyboard geometry: whole octaves around the notes in play ----
    const pitches = notes.map((n) => n.pitch);
    const lowest = pitches.length ? Math.min(...pitches) : 60;
    const highest = pitches.length ? Math.max(...pitches) : 72;
    const lo = Math.floor((lowest - 2) / 12) * 12;
    const hi = Math.ceil((highest + 3) / 12) * 12 - 1;
    const whiteIndex = new Map<number, number>();
    let whiteCount = 0;
    for (let p = lo; p <= hi; p++) {
      // A black key is positioned by the white key to its left.
      whiteIndex.set(p, isBlack(p) ? whiteCount - 1 : whiteCount++);
    }
    const trackColor = new Map(song.tracks.map((t, i) => [t.index, TRACK_COLORS[i % TRACK_COLORS.length]]));

    // Canvas text can't use CSS variables either, so read the loaded font names once.
    const displayFont = getComputedStyle(canvas).fontFamily;
    const bodyFont = getComputedStyle(document.body).fontFamily;

    let frame = 0;
    const draw = () => {
      const songTime = songTimeAt(performance.now());
      if (songTime >= stopAt) {
        finish(true);
        return;
      }
      frame = requestAnimationFrame(draw);

      const dpr = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
      }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);

      const keysHeight = Math.min(130, height * 0.22);
      const hitY = height - keysHeight;
      const whiteWidth = width / whiteCount;
      const blackWidth = whiteWidth * 0.6;
      const keyX = (p: number) =>
        isBlack(p) ? (whiteIndex.get(p)! + 1) * whiteWidth - blackWidth / 2 : whiteIndex.get(p)! * whiteWidth;
      const keyWidth = (p: number) => (isBlack(p) ? blackWidth : whiteWidth);
      const windowSec = FALL_SECONDS * rate;
      const y = (time: number) => hitY - ((time - songTime) / windowSec) * hitY;

      g.fillStyle = COLOR.night;
      g.fillRect(0, 0, width, height);

      g.save();
      g.beginPath();
      g.rect(0, 0, width, hitY);
      g.clip();

      // Beat and measure lines.
      g.font = `12px ${bodyFont}`;
      for (const beat of rangeBeats) {
        if (beat.time < songTime || beat.time > songTime + windowSec) continue;
        g.fillStyle = beat.downbeat ? COLOR.rule : COLOR.slate;
        g.fillRect(0, y(beat.time), width, beat.downbeat ? 2 : 1);
        if (beat.downbeat) {
          g.fillStyle = COLOR.haze;
          g.fillText(String(beat.measure + 1), 6, y(beat.time) - 5);
        }
      }

      // Falling notes.
      for (const n of notes) {
        if (n.start > songTime + windowSec) break;
        if (n.start + n.duration < songTime - windowSec) continue;
        const top = y(n.start + n.duration);
        const bottom = y(n.start);
        const missed = !matcher.matched.has(n.id) && n.start < songTime - tolSec;
        if (matcher.matched.has(n.id)) g.fillStyle = COLOR.snow;
        else if (missed) g.fillStyle = COLOR.night;
        else g.fillStyle = trackColor.get(n.track) ?? COLOR.gold;
        g.globalAlpha = isBlack(n.pitch) ? 0.8 : 1;
        g.beginPath();
        g.roundRect(keyX(n.pitch) + 2, top + 1, keyWidth(n.pitch) - 4, Math.max(bottom - top, 6) - 2, 2);
        g.fill();
        if (missed) {
          g.strokeStyle = COLOR.haze;
          g.lineWidth = 2;
          g.stroke();
        }
      }
      g.globalAlpha = 1;
      g.restore();

      // While the song waits, mark the keys it is waiting for.
      const waiting = gate?.waiting(performance.now() - startedAtPerf) ?? false;
      const wanted = new Map(waiting ? gate!.pending(tolSec).map((n) => [n.pitch, n.track]) : []);
      const marker = (p: number, keyHeight: number) => {
        if (!wanted.has(p) || held.has(p)) return;
        g.fillStyle = trackColor.get(wanted.get(p)!) ?? COLOR.gold;
        g.beginPath();
        g.roundRect(keyX(p) + 3, hitY + keyHeight - 18, keyWidth(p) - 6, 12, 2);
        g.fill();
      };

      // Keys, with the ones being held lit up.
      for (let p = lo; p <= hi; p++) {
        if (isBlack(p)) continue;
        g.fillStyle = held.has(p) ? COLOR.gold : COLOR.snow;
        g.fillRect(keyX(p) + 0.5, hitY, whiteWidth - 1, keysHeight);
        marker(p, keysHeight);
      }
      for (let p = lo; p <= hi; p++) {
        if (!isBlack(p)) continue;
        g.fillStyle = held.has(p) ? COLOR.flame : COLOR.night;
        g.fillRect(keyX(p), hitY, blackWidth, keysHeight * 0.62);
        marker(p, keysHeight * 0.62);
      }
      // A felt strip in the sunset stripes along the top of the keys, under the white hit line.
      STRIPES.forEach((stripe, i) => {
        g.fillStyle = stripe;
        g.fillRect(0, hitY + 1 + i * 3, width, 3);
      });
      g.fillStyle = COLOR.snow;
      g.fillRect(0, hitY - 2, width, 3);

      // Count-in: show the beat being counted.
      if (songTime < rangeStart) {
        const begun = countInBeats.filter((b) => b.time - countIn <= songTime).length;
        g.fillStyle = COLOR.snow;
        g.font = `120px ${displayFont}`;
        g.textAlign = 'center';
        g.fillText(String(Math.max(1, begun)), width / 2, hitY / 2);
        g.textAlign = 'start';

        // Under the number, a small stripe block with the ridge cut out of it.
        const blockWidth = 168;
        const blockHeight = 42;
        const left = width / 2 - blockWidth / 2;
        const top = hitY / 2 + 24;
        STRIPES.forEach((stripe, i) => {
          g.fillStyle = stripe;
          g.fillRect(left, top + (i * blockHeight) / 4, blockWidth, blockHeight / (i === 2 ? 2 : 4));
        });
        g.beginPath();
        g.moveTo(left - 2, top + blockHeight + 2);
        for (const [rx, ry] of RIDGE) g.lineTo(left + rx * blockWidth, top + ry * blockHeight);
        g.lineTo(left + blockWidth + 2, top + blockHeight + 2);
        g.fillStyle = COLOR.night;
        g.fill();
        g.beginPath();
        for (const [rx, ry] of RIDGE) g.lineTo(left + rx * blockWidth, top + ry * blockHeight);
        g.strokeStyle = COLOR.snow;
        g.lineWidth = 2.5;
        g.stroke();
        g.fillStyle = COLOR.snow;
        g.fillRect(left - 6, top - 6, 2, blockHeight + 6);
        g.fillRect(left - 6, top - 6, blockWidth + 6, 2);
      }

      if (positionRef.current) {
        let measure = config.startMeasure;
        while (measure < config.endMeasure && song.measures[measure + 1].start <= songTime) measure++;
        positionRef.current.textContent =
          `Measure ${measure + 1} of ${config.startMeasure + 1}–${config.endMeasure + 1}` +
          (waiting ? ' · waiting for you' : '');
      }
      if (hitsRef.current) hitsRef.current.textContent = `${matcher.matched.size} hit`;
    };
    frame = requestAnimationFrame(draw);

    return () => {
      finished = true;
      cancelAnimationFrame(frame);
      window.removeEventListener('keydown', onKeyDown);
      unsubscribe();
      metronome.stop();
    };
  }, [song, songId, config]);

  const toggleMetronome = () => {
    const next = !metronomeOn;
    setMetronomeOn(next);
    if (metronomeRef.current) metronomeRef.current.enabled = next;
  };

  return (
    <div className="fixed inset-0 z-10 flex flex-col bg-night">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-snow px-4 py-3">
        <p className="flex flex-wrap gap-x-4 text-sm">
          <span ref={positionRef} className="font-semibold" />
          <span ref={hitsRef} className="font-semibold text-gold" />
          <span className="text-haze">
            {Math.round(config.tempoRate * 100)}% tempo{config.wait ? ' · waits for each note' : ''}
          </span>
        </p>
        <div className="flex gap-3">
          {!config.wait && (
            <button type="button" className="btn" aria-pressed={metronomeOn} onClick={toggleMetronome}>
              Metronome {metronomeOn ? 'on' : 'off'}
            </button>
          )}
          <button type="button" className="btn btn-primary" onClick={() => endRef.current()}>
            End (Esc)
          </button>
        </div>
      </div>
      <canvas ref={canvasRef} className="min-h-0 w-full flex-1 font-display" />
    </div>
  );
}
