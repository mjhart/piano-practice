'use client';

import { useRef } from 'react';

type Range = [number, number];

type Props = {
  /** Inclusive measure indexes to show. */
  from: number;
  to: number;
  /** Accuracy from 0 to 1 by measure index; null or missing means no data. */
  values: (number | null | undefined)[];
  selection: Range | null;
  onSelect: (range: Range) => void;
};

const ordered = (a: number, b: number): Range => (a <= b ? [a, b] : [b, a]);

// The sunset stripes from globals.css, worst to best: ember, flame, gold.
const HEAT_STOPS = [
  [224, 67, 47],
  [240, 122, 38],
  [249, 201, 56],
];

/** Runs through the stripe colours, getting lighter as accuracy improves. */
export function heatColor(accuracy: number): string {
  const t = Math.min(Math.max(accuracy, 0), 1) * (HEAT_STOPS.length - 1);
  const i = Math.min(Math.floor(t), HEAT_STOPS.length - 2);
  const [r, g, b] = HEAT_STOPS[i].map((c, k) => Math.round(c + (HEAT_STOPS[i + 1][k] - c) * (t - i)));
  return `rgb(${r} ${g} ${b})`;
}

/** One cell per measure, coloured by accuracy. Drag (or shift-click) to select a section. */
export function HeatStrip({ from, to, values, selection, onSelect }: Props) {
  const anchor = useRef<number | null>(null);

  const pick = (measure: number, extend: boolean) => {
    if (extend && selection) {
      anchor.current = anchor.current ?? selection[0];
      onSelect(ordered(anchor.current, measure));
    } else {
      anchor.current = measure;
      onSelect([measure, measure]);
    }
  };

  const cells = [];
  for (let m = from; m <= to; m++) {
    const value = values[m] ?? null;
    const selected = !!selection && m >= selection[0] && m <= selection[1];
    cells.push(
      <button
        key={m}
        type="button"
        aria-pressed={selected}
        aria-label={`Measure ${m + 1}${value === null ? '' : `, ${Math.round(value * 100)}% accurate`}`}
        style={value === null ? undefined : { background: heatColor(value) }}
        className={`flex h-11 w-11 cursor-pointer flex-col items-center justify-center rounded-block border-2 text-xs leading-tight ${
          value === null ? 'bg-slate text-snow' : 'text-night'
        } ${selected ? 'border-snow shadow-[inset_0_0_0_2px_var(--color-night)]' : 'border-transparent'}`}
        onPointerDown={(e) => {
          e.preventDefault();
          pick(m, e.shiftKey);
        }}
        onPointerEnter={(e) => {
          if (e.buttons === 1 && anchor.current !== null) onSelect(ordered(anchor.current, m));
        }}
        onClick={(e) => {
          // Pointer presses are handled above; this covers the keyboard.
          if (e.detail === 0) pick(m, e.shiftKey);
        }}
      >
        <span className="font-bold">{m + 1}</span>
        <span className="text-[10px] font-medium">{value === null ? '–' : `${Math.round(value * 100)}%`}</span>
      </button>,
    );
  }
  return <div className="flex touch-none flex-wrap gap-1 select-none">{cells}</div>;
}
