'use client';

import { duelOutcome } from '../../lib/duel';
import type { RunScore } from '../../lib/scoring';
import { tempoText } from '../../lib/sources';
import type { Run } from '../../types';
import { HeatStrip } from './HeatStrip';
import { percent } from './Results';

type Props = {
  /** The player at the low end, then the one at the high end, with their scores and names. */
  runs: [Run, Run];
  scores: [RunScore, RunScore];
  names: [string, string];
  /** Absent when the duel can't be played again as it was, such as after a player was removed. */
  onRematch?: (swap: boolean) => void;
  onBack: () => void;
  backLabel: string;
};

const DECIDED_BY = {
  accuracy: 'Won on accuracy.',
  hits: 'Level on accuracy, won on notes hit.',
  timing: 'Level on accuracy and notes hit, won on steadier timing.',
};

export function DuelResults({ runs, scores, names, onRematch, onBack, backLabel }: Props) {
  const { winner, by } = duelOutcome(scores[0], scores[1]);
  const [run] = runs;
  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">
          Duel · {run.completed ? 'finished' : 'ended early'} · measures {run.startMeasure + 1}–{run.endMeasure + 1} ·{' '}
          {tempoText(run.source, run.tempoRate)}
        </p>
        <h1 className="title mt-2 text-6xl text-gold sm:text-7xl">{winner === null ? 'A draw' : `${names[winner]} wins`}</h1>
        {by && <p className="mt-2 text-sm text-haze">{DECIDED_BY[by]}</p>}
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        {runs.map((r, i) => {
          const score = scores[i];
          const values: (number | null)[] = [];
          for (const m of score.measures) values[m.measure] = m.accuracy;
          return (
            <section key={r.id} className={`card space-y-4 ${winner === i ? 'border-gold' : ''}`}>
              <div>
                <p className="eyebrow">{i === 0 ? 'Low end' : 'High end'}</p>
                <h2 className="title mt-1 text-2xl">{names[i]}</h2>
              </div>
              <p className={`title text-5xl ${winner === i ? 'text-gold' : ''}`}>{percent(score.accuracy)}</p>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="eyebrow">Hit</dt>
                  <dd className="title text-xl">{score.hits}</dd>
                </div>
                <div>
                  <dt className="eyebrow">Missed</dt>
                  <dd className="title text-xl">{score.misses}</dd>
                </div>
                <div>
                  <dt className="eyebrow">Wrong notes</dt>
                  <dd className="title text-xl">{score.extras}</dd>
                </div>
                <div>
                  <dt className="eyebrow">Typical offset</dt>
                  <dd className="title text-xl">
                    {score.meanAbsErrorMs === null ? '–' : `${Math.round(score.meanAbsErrorMs)} ms`}
                  </dd>
                </div>
              </dl>
              <HeatStrip from={r.startMeasure} to={r.endMeasure} values={values} selection={null} onSelect={() => {}} />
            </section>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-3">
        {onRematch && (
          <>
            <button type="button" className="btn btn-primary" onClick={() => onRematch(false)}>
              Rematch
            </button>
            <button type="button" className="btn" onClick={() => onRematch(true)}>
              Rematch, swap ends
            </button>
          </>
        )}
        <button type="button" className="btn" onClick={onBack}>
          {backLabel}
        </button>
      </div>
    </div>
  );
}
