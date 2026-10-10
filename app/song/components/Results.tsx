'use client';

import { useState } from 'react';
import type { RunScore } from '../../lib/scoring';
import type { Run } from '../../types';
import { HeatStrip } from './HeatStrip';

type Range = [number, number];

type Props = {
  run: Run;
  score: RunScore;
  onPractice: (range: Range) => void;
  onAgain: () => void;
  onBack: () => void;
};

export const percent = (value: number | null) => (value === null ? '–' : `${Math.round(value * 100)}%`);

// The weakest measure, widened to take in neighbours that also went badly.
function weakestSection(score: RunScore): Range | null {
  const played = score.measures.filter((m) => m.accuracy !== null);
  if (played.length === 0) return null;
  const worst = played.reduce((a, b) => (b.accuracy! < a.accuracy! ? b : a));
  if (worst.accuracy === 1) return null;
  const weak = new Set(played.filter((m) => m.accuracy! < 0.8).map((m) => m.measure));
  let from = worst.measure;
  let to = worst.measure;
  while (weak.has(from - 1)) from--;
  while (weak.has(to + 1)) to++;
  return [from, to];
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="eyebrow">{label}</p>
      <p className="title mt-1 text-2xl">{value}</p>
    </div>
  );
}

export function Results({ run, score, onPractice, onAgain, onBack }: Props) {
  const [selection, setSelection] = useState<Range | null>(() => weakestSection(score));
  const values: (number | null)[] = [];
  for (const m of score.measures) values[m.measure] = m.accuracy;

  const waitedMs = (run.holds ?? []).reduce((sum, h) => sum + h.ms, 0);
  const drift = score.meanErrorMs;
  const tendency =
    drift === null || Math.abs(drift) < 10 ? 'On the beat' : `${Math.round(Math.abs(drift))} ms ${drift > 0 ? 'late' : 'early'}`;

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">
          {run.completed ? 'Finished' : 'Ended early'} · measures {run.startMeasure + 1}–{run.endMeasure + 1} ·{' '}
          {Math.round(run.tempoRate * 100)}% tempo{run.wait ? ' · waited for each note' : ''}
        </p>
        <h1 className="title mt-2 text-7xl text-gold sm:text-8xl">{percent(score.accuracy)}</h1>
      </div>

      <div className="card grid grid-cols-2 gap-5 sm:grid-cols-5">
        <Stat label="Hit" value={String(score.hits)} />
        <Stat label="Missed" value={String(score.misses)} />
        <Stat label="Wrong notes" value={String(score.extras)} />
        {run.wait ? (
          // The clock waited for the player, so timing offsets say little here.
          <>
            <Stat label="Stops" value={String(run.holds?.length ?? 0)} />
            <Stat label="Time waiting" value={`${(waitedMs / 1000).toFixed(1)} s`} />
          </>
        ) : (
          <>
            <Stat
              label="Typical offset"
              value={score.meanAbsErrorMs === null ? '–' : `${Math.round(score.meanAbsErrorMs)} ms`}
            />
            <Stat label="Tendency" value={tendency} />
          </>
        )}
      </div>

      <section className="card space-y-4">
        <div>
          <h2 className="title text-2xl">Measure by measure</h2>
          <p className="mt-2 text-sm text-haze">
            Drag across measures, or shift-click, to choose a section to work on.
            {selection && !run.completed ? ' Measures you did not reach show a dash.' : ''}
          </p>
        </div>
        <HeatStrip
          from={run.startMeasure}
          to={run.endMeasure}
          values={values}
          selection={selection}
          onSelect={setSelection}
        />
      </section>

      <div className="flex flex-wrap gap-3">
        {selection && (
          <button type="button" className="btn btn-primary" onClick={() => onPractice(selection)}>
            Practice measures {selection[0] + 1}–{selection[1] + 1}
          </button>
        )}
        <button type="button" className="btn" onClick={onAgain}>
          Play it again
        </button>
        <button type="button" className="btn" onClick={onBack}>
          Back to the piece
        </button>
      </div>
    </div>
  );
}
