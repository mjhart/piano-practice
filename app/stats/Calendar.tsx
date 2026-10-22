'use client';

import { useState } from 'react';
import { addDays } from '../lib/stats';
import { duration } from './format';

type Props = {
  /** Practice on each day that had any, by YYYY-MM-DD. */
  days: Map<string, { ms: number; runs: number }>;
  today: string;
  weeks?: number;
};

// Minutes a day for each step of the scale, and how strongly each is drawn.
const LEVELS = [
  { minutes: 0, opacity: 0.3 },
  { minutes: 10, opacity: 0.55 },
  { minutes: 20, opacity: 0.8 },
  { minutes: 40, opacity: 1 },
];

const opacityFor = (ms: number) => LEVELS.findLast((l) => ms / 60000 >= l.minutes)!.opacity;

const dateOf = (day: string) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d);
};

const longDate = (day: string) =>
  dateOf(day).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });

/** One square per day, a column per week from Monday, gold as strong as the time practised. Tap a day for its total. */
export function Calendar({ days, today, weeks = 20 }: Props) {
  const [picked, setPicked] = useState<string | null>(null);
  const monday = addDays(today, -((dateOf(today).getDay() + 6) % 7));
  const first = addDays(monday, -7 * (weeks - 1));

  const cells = [];
  for (let i = 0; i < weeks * 7; i++) {
    const day = addDays(first, i);
    if (day > today) {
      cells.push(<span key={day} />);
      continue;
    }
    const practice = days.get(day);
    cells.push(
      <button
        key={day}
        type="button"
        title={`${longDate(day)}: ${practice ? duration(practice.ms) : 'no practice'}`}
        aria-label={`${longDate(day)}: ${practice ? duration(practice.ms) : 'no practice'}`}
        aria-pressed={picked === day}
        onClick={() => setPicked(picked === day ? null : day)}
        className={`aspect-square cursor-pointer rounded-[2px] ${practice ? '' : 'bg-slate'} ${
          picked === day ? 'outline-2 outline-offset-1 outline-snow' : ''
        }`}
        style={practice ? { background: 'var(--color-gold)', opacity: opacityFor(practice.ms) } : undefined}
      />,
    );
  }

  const shown = picked ?? today;
  const practice = days.get(shown);
  return (
    <div className="space-y-3">
      <div
        className="grid grid-flow-col gap-[3px]"
        style={{ gridTemplateColumns: `repeat(${weeks}, minmax(0, 1fr))`, gridTemplateRows: 'repeat(7, auto)' }}
      >
        {cells}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <p>
          <span className="text-haze">{picked ? longDate(shown) : 'Today'}:</span>{' '}
          {practice ? `${duration(practice.ms)}, ${practice.runs} ${practice.runs === 1 ? 'run' : 'runs'}` : 'no practice'}
        </p>
        <div className="flex items-center gap-1 text-xs text-haze" aria-hidden="true">
          Less
          <span className="h-3 w-3 rounded-[2px] bg-slate" />
          {LEVELS.map((l) => (
            <span key={l.minutes} className="h-3 w-3 rounded-[2px] bg-gold" style={{ opacity: l.opacity }} />
          ))}
          More
        </div>
      </div>
    </div>
  );
}
