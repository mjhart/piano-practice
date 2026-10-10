'use client';

import { useEffect, useRef } from 'react';
import type { SongModel } from '../../types';
import { COLOR } from './PracticeCanvas';

type Props = {
  song: SongModel;
  /** The parts to draw. */
  tracks: number[];
  colors: Map<number, string>;
  /** Inclusive measure indexes of the part of the piece that is kept. */
  first: number;
  last: number;
  onTrim: (first: number, last: number) => void;
  /** Song time of the playhead; called every frame, so it must be cheap. */
  position: () => number;
  onSeek: (time: number) => void;
};

/**
 * The whole piece as a piano roll: time runs left to right, pitch bottom to
 * top. The trimmed-off ends are dimmed and their edges can be dragged.
 */
export function TrackPreview({ song, tracks, colors, first, last, onTrim, position, onSeek }: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const latest = useRef({ position });

  useEffect(() => {
    latest.current = { position };
  });

  const duration = song.measures[song.measures.length - 1].end;
  const trimStart = song.measures[first].start;
  const trimEnd = song.measures[last].end;
  const percent = (time: number) => `${(time / duration) * 100}%`;

  // The notes only change with the piece and the chosen parts, so they are
  // drawn once; the playhead and trim edges are elements laid over the canvas.
  useEffect(() => {
    const canvas = canvasRef.current!;
    const draw = () => {
      const g = canvas.getContext('2d')!;
      const dpr = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = COLOR.night;
      g.fillRect(0, 0, width, height);

      const x = (time: number) => (time / duration) * width;
      // Number as many measures as fit without the labels touching.
      const every = [1, 2, 4, 8, 16, 32].find((k) => (k * width) / song.measures.length >= 34) ?? 64;
      g.font = `10px ${getComputedStyle(document.body).fontFamily}`;
      for (const m of song.measures) {
        const labelled = m.index % every === 0;
        g.fillStyle = labelled ? COLOR.rule : COLOR.slate;
        g.fillRect(Math.round(x(m.start)), 0, 1, height);
        if (labelled) {
          g.fillStyle = COLOR.haze;
          g.fillText(String(m.index + 1), Math.round(x(m.start)) + 3, 11);
        }
      }

      const shown = new Set(tracks);
      const notes = song.notes.filter((n) => shown.has(n.track));
      if (notes.length === 0) return;
      let lo = Infinity;
      let hi = -Infinity;
      for (const n of notes) {
        lo = Math.min(lo, n.pitch);
        hi = Math.max(hi, n.pitch);
      }
      // Leave room for the measure numbers above and never stretch a narrow part too tall.
      const top = 16;
      const row = Math.min((height - top - 4) / (hi - lo + 1), 8);
      const bottom = top + (height - top - 4 + row * (hi - lo + 1)) / 2;
      for (const n of notes) {
        g.fillStyle = colors.get(n.track) ?? COLOR.gold;
        g.fillRect(x(n.start), bottom - (n.pitch - lo + 1) * row, Math.max(x(n.duration) - 0.5, 1.5), Math.max(row - 0.5, 1));
      }
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [song, tracks, colors, duration]);

  useEffect(() => {
    let frame = 0;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      if (headRef.current) headRef.current.style.left = `${(latest.current.position() / duration) * 100}%`;
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [duration]);

  const timeAt = (clientX: number) => {
    const box = boxRef.current!.getBoundingClientRect();
    return (Math.min(Math.max(clientX - box.left, 0), box.width) / box.width) * duration;
  };

  // Trim edges snap to the nearest bar line.
  const dragEdge = (edge: 'start' | 'end') => (e: React.PointerEvent) => {
    if (e.buttons !== 1) return;
    const time = timeAt(e.clientX);
    let best = edge === 'start' ? first : last;
    let bestDistance = Infinity;
    for (const m of song.measures) {
      const distance = Math.abs((edge === 'start' ? m.start : m.end) - time);
      if (distance < bestDistance) {
        best = m.index;
        bestDistance = distance;
      }
    }
    if (edge === 'start') onTrim(Math.min(best, last), last);
    else onTrim(first, Math.max(best, first));
  };

  const handle = (edge: 'start' | 'end') => (
    <div
      role="slider"
      tabIndex={0}
      aria-label={edge === 'start' ? 'First measure' : 'Last measure'}
      aria-valuemin={edge === 'start' ? 1 : first + 1}
      aria-valuemax={edge === 'start' ? last + 1 : song.measures.length}
      aria-valuenow={(edge === 'start' ? first : last) + 1}
      className="group absolute inset-y-0 z-10 w-4 -translate-x-1/2 cursor-ew-resize touch-none"
      style={{ left: percent(edge === 'start' ? trimStart : trimEnd) }}
      onPointerDown={(e) => {
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={dragEdge(edge)}
      onKeyDown={(e) => {
        const step = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
        if (!step) return;
        e.preventDefault();
        if (edge === 'start') onTrim(Math.min(Math.max(first + step, 0), last), last);
        else onTrim(first, Math.min(Math.max(last + step, first), song.measures.length - 1));
      }}
    >
      <div className="mx-auto h-full w-0.5 bg-snow group-hover:bg-gold" />
      <div
        className={`absolute bottom-0 h-5 w-2.5 bg-snow group-hover:bg-gold ${edge === 'start' ? 'left-1/2' : 'right-1/2'}`}
      />
    </div>
  );

  return (
    <div
      ref={boxRef}
      className="relative h-56 cursor-pointer overflow-hidden rounded-block border-2 border-rule select-none"
      onPointerDown={(e) => onSeek(timeAt(e.clientX))}
    >
      <canvas ref={canvasRef} className="block h-full w-full" />
      {tracks.length === 0 && (
        <p className="absolute inset-0 flex items-center justify-center text-sm text-haze">Tick a part to see it here.</p>
      )}
      <div className="absolute inset-y-0 left-0 bg-night/75" style={{ width: percent(trimStart) }} />
      <div className="absolute inset-y-0 right-0 bg-night/75" style={{ left: percent(trimEnd) }} />
      <div ref={headRef} className="pointer-events-none absolute inset-y-0 w-0.5 bg-ember" />
      {handle('start')}
      {handle('end')}
    </div>
  );
}
