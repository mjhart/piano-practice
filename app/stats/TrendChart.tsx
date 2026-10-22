'use client';

import { useEffect, useRef, useState } from 'react';

type Point = { day: string; value: number };

type Props = {
  /** Oldest first, one per YYYY-MM-DD day. */
  points: Point[];
  /** The top of the scale; the bottom is 0. */
  max: number;
  ticks: number[];
  format: (value: number) => string;
  /** What a point is, for the tooltip: "accuracy". */
  label: string;
  height?: number;
};

const PAD = { top: 12, right: 12, bottom: 24, left: 44 };

const dayNumber = (day: string) => {
  const [y, m, d] = day.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
};

const dayText = (day: string) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString([], { day: 'numeric', month: 'short' });
};

/** A line through one value per practice day, spaced by date. Point at or tap the chart for a day's value, shown below it. */
export function TrendChart({ points, max, ticks, format, label, height = 180 }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const first = dayNumber(points[0].day);
  const last = dayNumber(points.at(-1)!.day);
  const plotW = Math.max(width - PAD.left - PAD.right, 1);
  const plotH = height - PAD.top - PAD.bottom;
  const x = (day: string) => PAD.left + (last === first ? plotW / 2 : ((dayNumber(day) - first) / (last - first)) * plotW);
  const y = (value: number) => PAD.top + plotH - (Math.min(value, max) / max) * plotH;
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.day)},${y(p.value)}`).join('');

  const pick = (clientX: number) => {
    const left = box.current!.getBoundingClientRect().left;
    let best = 0;
    points.forEach((p, i) => {
      if (Math.abs(x(p.day) - (clientX - left)) < Math.abs(x(points[best].day) - (clientX - left))) best = i;
    });
    setActive(best);
  };

  const shown = active === null ? null : points[active];
  return (
    <div ref={box} className="touch-pan-y select-none">
      {width > 0 && (
        <svg
          width={width}
          height={height}
          className="block"
          role="img"
          aria-label={`${label} by day, from ${dayText(points[0].day)} to ${dayText(points.at(-1)!.day)}`}
          onPointerMove={(e) => pick(e.clientX)}
          onPointerDown={(e) => pick(e.clientX)}
          onPointerLeave={(e) => e.pointerType === 'mouse' && setActive(null)}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} className="stroke-rule" strokeOpacity={0.5} />
              <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-haze text-[11px]">
                {format(t)}
              </text>
            </g>
          ))}
          <text x={PAD.left} y={height - 6} className="fill-haze text-[11px]">
            {dayText(points[0].day)}
          </text>
          {points.length > 1 && (
            <text x={width - PAD.right} y={height - 6} textAnchor="end" className="fill-haze text-[11px]">
              {dayText(points.at(-1)!.day)}
            </text>
          )}
          {shown && (
            <line x1={x(shown.day)} x2={x(shown.day)} y1={PAD.top} y2={PAD.top + plotH} className="stroke-haze" />
          )}
          <path d={path} fill="none" strokeWidth={2} strokeLinejoin="round" className="stroke-gold" />
          {points.map((p, i) => (
            <circle
              key={p.day}
              cx={x(p.day)}
              cy={y(p.value)}
              r={i === active ? 6 : 4}
              strokeWidth={2}
              className="fill-gold stroke-night"
            />
          ))}
        </svg>
      )}
      {width === 0 && <div style={{ height }} />}
      <p className="text-sm">
        {shown ? (
          <>
            <span className="text-haze">{dayText(shown.day)}:</span> {format(shown.value)} {label}
          </>
        ) : (
          <span className="text-haze">Point at or tap a day for its value.</span>
        )}
      </p>
    </div>
  );
}
