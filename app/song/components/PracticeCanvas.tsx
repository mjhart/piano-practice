'use client';

import { useEffect, useRef, useState } from 'react';
import { Metronome, type Click } from '../../lib/metronome';
import { subscribeNotes } from '../../lib/midiInput';
import { getMetronomeOffset } from '../../lib/prefs';
import { DEFAULT_TOLERANCE_MS, Matcher, WaitGate, expectedNotes, songTimeOf } from '../../lib/scoring';
import { sourceKeyOf, tempoText } from '../../lib/sources';
import type { Exercise, PlayedEvent, Run, RunSource, SongModel } from '../../types';

export type PracticeConfig = {
  tracks: number[];
  startMeasure: number;
  endMeasure: number;
  tempoRate: number;
  metronome: boolean;
  /** Stop at each note until it is played. */
  wait: boolean;
  /** Play the section over and over until stopped. Each pass is recorded as its own run. */
  loop: boolean;
};

type Props = {
  song: SongModel;
  /** What is being played, recorded on every run. For a drill, `song` is its exercise. */
  source: RunSource;
  /** Who is playing; every run recorded belongs to them. */
  userId: string;
  config: PracticeConfig;
  /** A run was recorded: the whole section, or one pass of a loop. */
  onRun: (run: Run) => void;
  /** Practice ended. Every run recorded, oldest first; empty if it ended before the first measure began. */
  onEnd: (runs: Run[]) => void;
};

// Canvas can't read Tailwind classes; these mirror the tokens in globals.css.
export const COLOR = {
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
export const TRACK_COLORS = [COLOR.gold, COLOR.ember, COLOR.flame, '#f4a98c'];
const STRIPES = [COLOR.ember, COLOR.flame, COLOR.gold];
// The ridge under the count-in number, as fractions of its stripe block.
const RIDGE = [
  [0, 0.8], [0.1, 0.55], [0.17, 0.72], [0.3, 0.38], [0.4, 0.7], [0.5, 0.58],
  [0.66, 0.2], [0.78, 0.62], [0.86, 0.48], [1, 0.82],
];

/** Real seconds between a note appearing at the top and reaching the keys. */
const FALL_SECONDS = 3;
/** The smallest annotation text; on narrower keys it goes on a tab wider than the note. */
const MIN_ANNOTATION_PX = 11;
/** Real milliseconds of quiet before the count-in, so the first click is never clipped. */
const LEAD_MS = 300;

const isBlack = (pitch: number) => [1, 3, 6, 8, 10].includes(pitch % 12);

export function PracticeCanvas({ song, source, userId, config, onRun, onEnd }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const positionRef = useRef<HTMLSpanElement>(null);
  const hitsRef = useRef<HTMLSpanElement>(null);
  const metronomeRef = useRef<Metronome | null>(null);
  const endRef = useRef<() => void>(() => {});
  const restartRef = useRef<() => void>(() => {});
  const callbacks = useRef({ onRun, onEnd });
  const [metronomeOn, setMetronomeOn] = useState(config.metronome);
  const metronomeOnRef = useRef(metronomeOn);
  // Every run recorded since practice began. A restart keeps them and starts the transport again.
  const recordedRef = useRef<Run[]>([]);
  const [restarts, setRestarts] = useState(0);

  useEffect(() => {
    callbacks.current = { onRun, onEnd };
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
    const countInMs = (countIn / rate) * 1000;
    const originTime = rangeStart - countIn;
    const loopLength = rangeEnd - rangeStart;
    // Keep going a moment past the last measure so a late final note still counts.
    const stopAt = rangeEnd + tolSec + 0.4 * rate;

    // ---- Passes ----
    // Each pass through the section has its own clock, matcher and events, so it
    // is stored as an ordinary run. When looping, each pass's clock reaches the
    // start of the section just as the one before reaches the end, as if it had
    // counted in over the last measure, so the music runs on.
    type Pass = {
      number: number;
      startedAtPerf: number;
      startedAt: number;
      matcher: Matcher;
      // In wait mode the clock stops at each note until the matcher pairs it.
      gate: WaitGate | null;
      events: PlayedEvent[];
      done: boolean;
    };
    const newPass = (number: number, startedAtPerf: number): Pass => {
      const matcher = new Matcher(notes, DEFAULT_TOLERANCE_MS, rate, rangeStart);
      return {
        number,
        startedAtPerf,
        startedAt: Date.now() + (startedAtPerf - performance.now()),
        matcher,
        gate: config.wait ? new WaitGate(notes, matcher, originTime, rate) : null,
        events: [],
        done: false,
      };
    };
    const songTimeAt = (pass: Pass, perf: number) =>
      pass.gate
        ? pass.gate.songTime(perf - pass.startedAtPerf)
        : songTimeOf({ originTime, tempoRate: rate }, perf - pass.startedAtPerf);
    // When a pass reached the end of the section. Every stop comes before that, so its holds are complete.
    const endPerf = (pass: Pass) =>
      pass.startedAtPerf +
      ((rangeEnd - originTime) / rate) * 1000 +
      (pass.gate?.holds.reduce((sum, h) => sum + h.ms, 0) ?? 0);
    // After a restart, loop passes carry on numbering from the ones already recorded.
    const recorded = recordedRef.current;
    const firstPass = recorded.length + 1;
    let current = newPass(firstPass, performance.now() + LEAD_MS);
    // Around the loop point: the pass before, while a late final note can still
    // count there, and the next pass, so an early first note counts there.
    let previous: Pass | null = null;
    let next: Pass | null = null;

    // ---- Metronome ----
    // Clicks are scheduled ahead on a steady clock, so wait mode keeps only the count-in.
    const rangeBeats = song.beats.filter((b) => b.measure >= config.startMeasure && b.measure <= config.endMeasure);
    const countInBeats = rangeBeats.filter((b) => b.measure === config.startMeasure);
    const clicksFor = (startedAtPerf: number, withCountIn: boolean): Click[] => {
      const at = (songTime: number) => startedAtPerf + ((songTime - originTime) / rate) * 1000;
      return [
        ...(withCountIn
          ? countInBeats.map((b) => ({ perfTime: at(b.time - countIn), downbeat: b.downbeat, countIn: true }))
          : []),
        ...(config.wait ? [] : rangeBeats.map((b) => ({ perfTime: at(b.time), downbeat: b.downbeat, countIn: false }))),
      ];
    };
    // Without wait mode every pass is the same length, so the clicks for the next pass are queued a pass ahead.
    const loopMs = (loopLength / rate) * 1000;
    const metronome = new Metronome(
      [
        ...clicksFor(current.startedAtPerf, true),
        ...(config.loop && !config.wait ? clicksFor(current.startedAtPerf + loopMs, false) : []),
      ],
      metronomeOnRef.current && !config.wait,
      getMetronomeOffset(),
    );
    metronomeRef.current = metronome;
    metronome.start();

    // ---- Ending passes ----
    const finishPass = (pass: Pass, perf: number, completed: boolean) => {
      if (pass.done) return;
      pass.done = true;
      const reachedTime = songTimeAt(pass, perf);
      pass.gate?.update(perf - pass.startedAtPerf, true);
      // Ended before the first measure began: nothing to record.
      if (reachedTime <= rangeStart) return;
      const run: Run = {
        id: crypto.randomUUID(),
        source,
        sourceKey: sourceKeyOf(source),
        userId,
        startedAt: pass.startedAt,
        startMeasure: config.startMeasure,
        endMeasure: config.endMeasure,
        tempoRate: rate,
        tracks: config.tracks,
        metronome: config.metronome && !config.wait,
        ...(pass.gate && { wait: true, holds: pass.gate.holds }),
        ...(config.loop && { pass: pass.number }),
        toleranceMs: DEFAULT_TOLERANCE_MS,
        originTime,
        reachedTime,
        completed,
        events: pass.events,
      };
      recorded.push(run);
      callbacks.current.onRun(run);
    };

    let ended = false;
    const end = (completed: boolean) => {
      if (ended) return;
      ended = true;
      const now = performance.now();
      if (previous) finishPass(previous, now, true);
      finishPass(current, now, completed);
      if (next) finishPass(next, now, false);
      callbacks.current.onEnd(recorded);
    };
    endRef.current = () => end(false);
    // Starting again throws away the pass being played, so it never counts as a run.
    // A loop pass that already reached the end is complete, so it is kept.
    const restart = () => {
      if (ended) return;
      ended = true;
      if (previous) finishPass(previous, performance.now(), true);
      setRestarts((n) => n + 1);
    };
    restartRef.current = restart;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') end(false);
      else if ((e.key === 'r' || e.key === 'R') && !e.metaKey && !e.ctrlKey && !e.altKey) restart();
    };
    window.addEventListener('keydown', onKeyDown);

    /** Moves the transport on to `perf`: closes passes that are over and opens the next one. */
    const advance = (perf: number) => {
      if (previous && songTimeAt(previous, perf) >= rangeEnd + tolSec) finishPass(previous, perf, true);
      const songTime = songTimeAt(current, perf);
      if (!config.loop) {
        if (songTime >= stopAt) end(true);
        return;
      }
      // In wait mode, when the next pass starts is only known once every note in this one is played.
      if (!next && songTime >= rangeEnd - tolSec && (current.gate?.released ?? true)) {
        next = newPass(current.number + 1, endPerf(current) - countInMs);
        if (!config.wait) metronome.add(clicksFor(next.startedAtPerf + loopMs, false));
      }
      if (next && songTime >= rangeEnd) {
        if (previous) finishPass(previous, perf, true);
        previous = current;
        current = next;
        next = null;
      }
    };

    // ---- Input and live matching ----
    const held = new Set<number>();
    const unsubscribe = subscribeNotes((e) => {
      if (e.on) held.add(e.pitch);
      else held.delete(e.pitch);
      if (ended) return;
      advance(e.timeStamp);
      // A note belongs to the pass being played, unless it only pairs with a
      // note in the one before or after: a late last note or an early first one.
      const neighbour = [previous, next].find(
        (p) =>
          p &&
          !p.done &&
          e.on &&
          !current.matcher.wouldMatch(songTimeAt(current, e.timeStamp), e.pitch) &&
          p.matcher.wouldMatch(songTimeAt(p, e.timeStamp), e.pitch),
      );
      const pass = neighbour ?? current;
      const t = e.timeStamp - pass.startedAtPerf;
      if (t < 0) return;
      pass.events.push({ t, pitch: e.pitch, velocity: e.velocity, on: e.on });
      if (!e.on) return;
      pass.matcher.noteOn(songTimeAt(pass, e.timeStamp), e.pitch);
      pass.gate?.update(t);
    });

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
    // A drill labels its measures, such as "B♭ major · ii"; they go beside the measure number.
    const tags = (song as Partial<Exercise>).tags;
    const measureLabel = (measure: number) =>
      [String(measure + 1), ...Object.values(tags?.[measure] ?? {})].join(' · ');
    const trackColor = new Map(song.tracks.map((t, i) => [t.index, TRACK_COLORS[i % TRACK_COLORS.length]]));

    // Canvas text can't use CSS variables either, so read the loaded font names once.
    const displayFont = getComputedStyle(canvas).fontFamily;
    const bodyFont = getComputedStyle(document.body).fontFamily;

    let frame = 0;
    const draw = () => {
      const now = performance.now();
      advance(now);
      if (ended) return;
      frame = requestAnimationFrame(draw);
      const songTime = songTimeAt(current, now);

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

      // What is on screen, in this pass's song time: this pass, the tail of the
      // one before, and when looping, the passes still to come.
      const layers: { offset: number; matcher: Matcher | null }[] = [{ offset: 0, matcher: current.matcher }];
      if (previous) layers.push({ offset: -loopLength, matcher: previous.matcher });
      for (let k = 1; config.loop && loopLength > 0 && rangeStart + k * loopLength <= songTime + windowSec; k++) {
        layers.push({ offset: k * loopLength, matcher: k === 1 ? (next?.matcher ?? null) : null });
      }

      // Beat and measure lines.
      g.font = `12px ${bodyFont}`;
      for (const { offset } of layers) {
        for (const beat of rangeBeats) {
          const time = beat.time + offset;
          if (time < songTime || time > songTime + windowSec) continue;
          g.fillStyle = beat.downbeat ? COLOR.rule : COLOR.slate;
          g.fillRect(0, y(time), width, beat.downbeat ? 2 : 1);
          if (beat.downbeat) {
            g.fillStyle = COLOR.haze;
            g.fillText(measureLabel(beat.measure), 6, y(time) - 5);
          }
        }
      }

      // Falling notes, with annotations sized to fit across them.
      const annotationSize = (p: number) => Math.min(16, Math.floor(keyWidth(p) - (isBlack(p) ? 2 : 6)));
      let font = '';
      g.textAlign = 'center';
      g.textBaseline = 'bottom';
      for (const { offset, matcher } of layers) {
        for (const n of notes) {
          const start = n.start + offset;
          if (start > songTime + windowSec) break;
          if (start + n.duration < songTime - windowSec) continue;
          const top = y(start + n.duration);
          const bottom = y(start);
          const hit = matcher?.matched.has(n.id) ?? false;
          const missed = matcher !== null && !hit && start < songTime - tolSec;
          if (hit) g.fillStyle = COLOR.snow;
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
          // An annotation, such as a finger number, sits at the note's leading edge, which reaches the keys
          // first. On keys too narrow to hold it, it sits on a round tab as wide as it needs.
          if (n.annotation && bottom - top >= 14) {
            const inside = annotationSize(n.pitch);
            const size = Math.max(inside, MIN_ANNOTATION_PX);
            const wanted = `600 ${size}px ${bodyFont}`;
            if (font !== wanted) g.font = font = wanted;
            const x = keyX(n.pitch) + keyWidth(n.pitch) / 2;
            if (inside < MIN_ANNOTATION_PX) {
              g.beginPath();
              g.arc(x, bottom - size / 2 - 3, size / 2 + 3, 0, Math.PI * 2);
              g.fill();
              if (missed) g.stroke();
            }
            g.globalAlpha = 1;
            g.fillStyle = missed ? COLOR.haze : COLOR.night;
            g.fillText(n.annotation, x, bottom - 3);
          }
        }
      }
      g.globalAlpha = 1;
      g.textAlign = 'start';
      g.textBaseline = 'alphabetic';
      g.restore();

      // While the song waits, mark the keys it is waiting for.
      const gate = current.gate;
      const waiting = gate?.waiting(now - current.startedAtPerf) ?? false;
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
      if (current.number === firstPass && songTime < rangeStart) {
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
          (config.loop ? ` · pass ${current.number}` : '') +
          (waiting ? ' · waiting for you' : '');
      }
      if (hitsRef.current) hitsRef.current.textContent = `${current.matcher.matched.size} hit`;
    };
    frame = requestAnimationFrame(draw);

    return () => {
      ended = true;
      cancelAnimationFrame(frame);
      window.removeEventListener('keydown', onKeyDown);
      unsubscribe();
      metronome.stop();
    };
  }, [song, source, userId, config, restarts]);

  const toggleMetronome = () => {
    const next = !metronomeOn;
    setMetronomeOn(next);
    metronomeOnRef.current = next;
    if (metronomeRef.current) metronomeRef.current.enabled = next;
  };

  return (
    <div className="fixed inset-0 z-10 flex flex-col bg-night">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-snow px-4 py-3">
        <p className="flex flex-wrap gap-x-4 text-sm">
          <span ref={positionRef} className="font-semibold" />
          <span ref={hitsRef} className="font-semibold text-gold" />
          <span className="text-haze">
            {tempoText(source, config.tempoRate)}
            {config.wait ? ' · waits for each note' : ''}
            {config.loop ? ' · looping' : ''}
          </span>
        </p>
        <div className="flex gap-3">
          {!config.wait && (
            <button type="button" className="btn" aria-pressed={metronomeOn} onClick={toggleMetronome}>
              Metronome {metronomeOn ? 'on' : 'off'}
            </button>
          )}
          <button type="button" className="btn" onClick={() => restartRef.current()}>
            Restart (R)
          </button>
          <button type="button" className="btn btn-primary" onClick={() => endRef.current()}>
            End (Esc)
          </button>
        </div>
      </div>
      <canvas ref={canvasRef} className="min-h-0 w-full flex-1 font-display" />
    </div>
  );
}
