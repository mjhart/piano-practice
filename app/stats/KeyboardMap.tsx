'use client';

import { useState } from 'react';
import { isWhite, pitchName } from '../lib/drills/theory';
import type { KeyTally } from '../lib/stats';
import { heatColor } from '../song/components/HeatStrip';
import { percent } from '../song/components/Results';

const WHITE_W = 20;
const WHITE_H = 90;
const BLACK_W = 12;
const BLACK_H = 56;

const hitRate = (k: KeyTally) => (k.hits + k.misses ? k.hits / (k.hits + k.misses) : null);

export function describeKey(k: KeyTally | undefined, pitch: number): string {
  if (!k) return `${pitchName(pitch)}: nothing to play yet`;
  const notes = k.hits + k.misses;
  const parts = [notes ? `${k.hits} of ${notes} hit (${percent(hitRate(k))})` : 'nothing to play'];
  if (k.wrong) parts.push(`pressed ${k.wrong} ${k.wrong === 1 ? 'time' : 'times'} by mistake`);
  return `${pitchName(pitch)}: ${parts.join(', ')}`;
}

/**
 * The keys a player has used, whole octaves from C, each coloured by how often
 * the notes written for it were hit. Tap a key for its numbers.
 */
export function KeyboardMap({ keys }: { keys: KeyTally[] }) {
  const [picked, setPicked] = useState<number | null>(null);
  const byPitch = new Map(keys.map((k) => [k.pitch, k]));
  const low = Math.floor(keys[0].pitch / 12) * 12;
  const high = Math.floor(keys.at(-1)!.pitch / 12) * 12 + 11;

  const whites: number[] = [];
  const blacks: { pitch: number; x: number }[] = [];
  for (let p = low; p <= high; p++) {
    if (isWhite(p)) whites.push(p);
    else blacks.push({ pitch: p, x: whites.length * WHITE_W - BLACK_W / 2 });
  }
  const width = whites.length * WHITE_W;

  const fill = (pitch: number, white: boolean) => {
    const rate = byPitch.get(pitch) && hitRate(byPitch.get(pitch)!);
    if (rate !== null && rate !== undefined) return heatColor(rate);
    return white ? 'var(--color-slate)' : 'var(--color-night)';
  };
  const key = (pitch: number, x: number, w: number, h: number, white: boolean) => (
    <rect
      key={pitch}
      x={x}
      y={0}
      width={w}
      height={h}
      rx={2}
      fill={fill(pitch, white)}
      strokeWidth={picked === pitch && !white ? 3 : white ? 1.5 : 1}
      className={`cursor-pointer ${picked === pitch && !white ? 'stroke-snow' : white ? 'stroke-night' : 'stroke-rule'}`}
      onClick={() => setPicked(picked === pitch ? null : pitch)}
    >
      <title>{describeKey(byPitch.get(pitch), pitch)}</title>
    </rect>
  );

  return (
    <div className="space-y-2">
      <svg viewBox={`0 0 ${width} ${WHITE_H}`} className="block h-auto w-full" role="img" aria-label="Hit rate by key">
        {whites.map((p, i) => key(p, i * WHITE_W, WHITE_W, WHITE_H, true))}
        {blacks.map((b) => key(b.pitch, b.x, BLACK_W, BLACK_H, false))}
        {picked !== null && isWhite(picked) && (
          // A white key's outline is partly under the black keys, so the picked one is outlined again on top.
          <rect
            x={whites.indexOf(picked) * WHITE_W}
            y={0}
            width={WHITE_W}
            height={WHITE_H}
            rx={2}
            fill="none"
            strokeWidth={3}
            className="pointer-events-none stroke-snow"
          />
        )}
      </svg>
      <div className="relative h-4 text-xs text-haze" aria-hidden="true">
        {whites.map((p, i) =>
          p % 12 === 0 ? (
            <span key={p} className="absolute" style={{ left: `${(i / whites.length) * 100}%` }}>
              {pitchName(p)}
            </span>
          ) : null,
        )}
      </div>
      <p className="text-sm">{picked === null ? <span className="text-haze">Tap a key for its numbers.</span> : describeKey(byPitch.get(picked), picked)}</p>
    </div>
  );
}
