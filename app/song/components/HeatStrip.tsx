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

/** The measure cell under a point, if any. */
function measureAt(x: number, y: number): number | null {
  const cell = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-measure]');
  return cell ? Number(cell.dataset.measure) : null;
}

/**
 * One cell per measure, coloured by accuracy. Tap a measure to select it, then tap another to extend the selection
 * to it; drag across measures (or shift-click) to select a section in one go. On touch the strip still scrolls
 * vertically, so a section is only selected once a press ends or turns into a sideways drag.
 */
export function HeatStrip({ from, to, values, selection, onSelect }: Props) {
  // The end of a drag or shift-click selection that stays put.
  const anchor = useRef<number | null>(null);
  // The measure a press started on, and whether it has since dragged to another one.
  const press = useRef<{ measure: number; dragged: boolean } | null>(null);
  // A measure tapped on its own, waiting for a second tap to make it a section.
  const pending = useRef<number | null>(null);

  const tap = (measure: number, extend: boolean) => {
    if (extend && selection) {
      anchor.current = anchor.current ?? selection[0];
      pending.current = null;
      onSelect(ordered(anchor.current, measure));
    } else if (
      pending.current !== null &&
      pending.current !== measure &&
      selection?.[0] === pending.current &&
      selection[1] === pending.current
    ) {
      anchor.current = pending.current;
      pending.current = null;
      onSelect(ordered(anchor.current, measure));
    } else {
      anchor.current = measure;
      pending.current = measure;
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
        data-measure={m}
        aria-pressed={selected}
        aria-label={`Measure ${m + 1}${value === null ? '' : `, ${Math.round(value * 100)}% accurate`}`}
        style={value === null ? undefined : { background: heatColor(value) }}
        className={`flex h-11 w-11 cursor-pointer flex-col items-center justify-center rounded-block border-2 text-xs leading-tight ${
          value === null ? 'bg-slate text-snow' : 'text-night'
        } ${selected ? 'border-snow shadow-[inset_0_0_0_2px_var(--color-night)]' : 'border-transparent'}`}
        onKeyDown={(e) => {
          // Pointer presses are handled on the strip; this covers the keyboard. Not onClick, since a touch tap's
          // click can arrive looking like a keyboard one and would undo the selection.
          if (e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault();
          tap(m, e.shiftKey);
        }}
      >
        <span className="font-bold">{m + 1}</span>
        <span className="text-[10px] font-medium">{value === null ? '–' : `${Math.round(value * 100)}%`}</span>
      </button>,
    );
  }

  return (
    <div
      // pan-y keeps vertical scrolling on touch; sideways drags come here instead.
      className="flex touch-pan-y flex-wrap gap-1 select-none [-webkit-touch-callout:none]"
      onPointerDown={(e) => {
        const m = measureAt(e.clientX, e.clientY);
        if (m === null || (e.pointerType === 'mouse' && e.button !== 0)) return;
        e.preventDefault();
        // Keep the rest of the press here, even if it wanders off the strip.
        e.currentTarget.setPointerCapture(e.pointerId);
        press.current = { measure: m, dragged: false };
        // A mouse can't be scrolling, so it selects straight away, as it always has.
        if (e.pointerType === 'mouse') tap(m, e.shiftKey);
      }}
      onPointerMove={(e) => {
        const p = press.current;
        if (!p) return;
        const m = measureAt(e.clientX, e.clientY);
        if (m === null || (m === p.measure && !p.dragged)) return;
        p.dragged = true;
        anchor.current = p.measure;
        pending.current = null;
        onSelect(ordered(p.measure, m));
      }}
      onPointerUp={(e) => {
        const p = press.current;
        press.current = null;
        if (p && !p.dragged && e.pointerType !== 'mouse') tap(p.measure, false);
      }}
      onPointerCancel={() => {
        // The browser took the touch over to scroll the page.
        press.current = null;
      }}
    >
      {cells}
    </div>
  );
}
