'use client';

import type { RunScore } from '../../lib/scoring';
import { tempoText } from '../../lib/sources';
import type { Run } from '../../types';
import { heatColor } from './HeatStrip';
import { percent } from './Results';

type Props = {
  /** Oldest first, with a score for each run at the same index. */
  runs: Run[];
  scores: RunScore[];
  onOpen: (run: Run) => void;
  /** Says what was played, for a history that mixes different exercises. */
  describe?: (run: Run) => string;
  /** A player's name, for a duel's opponent. */
  nameOf: (userId: string) => string;
};

export function RunHistory({ runs, scores, onOpen, describe, nameOf }: Props) {
  if (runs.length === 0) return <p className="text-sm text-haze">No practice runs yet.</p>;
  return (
    <ul className="divide-y divide-rule">
      {runs
        .map((run, i) => ({ run, score: scores[i] }))
        .reverse()
        .map(({ run, score }) => (
          <li key={run.id}>
            <button
              type="button"
              className="flex w-full cursor-pointer flex-wrap items-center gap-x-4 gap-y-1 py-3 text-left text-sm hover:text-gold"
              onClick={() => onOpen(run)}
            >
              <span
                className={`w-14 rounded-block px-2 py-1 text-center font-semibold ${
                  score.accuracy === null ? 'text-snow' : 'text-night'
                }`}
                style={score.accuracy === null ? undefined : { background: heatColor(score.accuracy) }}
              >
                {percent(score.accuracy)}
              </span>
              <span className="flex-1">
                {describe ? `${describe(run)}, measures` : 'Measures'} {run.startMeasure + 1}–{run.endMeasure + 1} at{' '}
                {tempoText(run.source, run.tempoRate).replace(' tempo', '')}
                {run.wait ? ', waiting for each note' : ''}
                {run.pass ? `, loop pass ${run.pass}` : ''}
                {run.duel ? `, duel with ${nameOf(run.duel.opponentId)}` : ''}
                {run.completed ? '' : ' (ended early)'}
              </span>
              <span className="text-haze">
                {new Date(run.startedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
              </span>
            </button>
          </li>
        ))}
    </ul>
  );
}
