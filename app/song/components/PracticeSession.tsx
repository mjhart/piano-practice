'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { KissShower } from '../../components/KissShower';
import { defaultDuelLayout, duelLayouts, duelRange } from '../../lib/duel';
import { getMetronomeOffset, setMetronomeOffset } from '../../lib/prefs';
import { earnsKiss } from '../../lib/easterEgg';
import { expectedNotes, scoreRun } from '../../lib/scoring';
import { sourceKeyOf } from '../../lib/sources';
import { store } from '../../lib/store';
import { useUsers } from '../../lib/users';
import type { Run, RunSource, SongModel, User } from '../../types';
import { DuelResults } from './DuelResults';
import { HeatStrip, heatColor } from './HeatStrip';
import { PracticeCanvas, type PracticeConfig } from './PracticeCanvas';
import { Results, percent } from './Results';
import { RunHistory } from './RunHistory';

type Range = [number, number];

type Mode =
  | { kind: 'setup' }
  /** `userId` is who started playing, so switching player mid-run doesn't move the run. */
  | { kind: 'playing'; config: PracticeConfig; userId: string }
  /** `passes` holds every pass of a loop, oldest first, when there was more than one. */
  | { kind: 'results'; run: Run; passes?: Run[] }
  /** Both runs of a duel: the player at the low end, then the high end. */
  | { kind: 'duel'; runs: [Run, Run] };

type Props = {
  /** The title block, shown above everything else on the setup screen. */
  heading: ReactNode;
  /** Shown between the heading and the section picker, such as a drill's settings. */
  children?: ReactNode;
  /** What the next run plays, and what it records it played. */
  model: SongModel;
  source: RunSource;
  /** Inclusive measure indexes of the part that can be practised. */
  trim: Range;
  /** The section to open on, such as one picked out on the statistics page. Clamped to `trim`. */
  initialRange?: Range;
  initialTracks: number[];
  initialTempoRate: number;
  tempo: { min: number; max: number; step: number; label: (rate: number) => ReactNode };
  /** The model a stored run was played against, to score it. */
  modelOf: (run: Run) => SongModel;
  /** Whether a run played the exercise in `model`, so its measures line up with it. */
  sameExercise: (run: Run) => boolean;
  /** Sets up the exercise an older run played, when it differs. */
  onRestore?: (run: Run) => void;
  describe?: (run: Run) => string;
  /** What all of it is called: "Whole piece". */
  wholeLabel: string;
  backLabel: string;
};

/**
 * Choosing what to practise, playing it, the results and the history: all that
 * a piece and a drill share. Each run of `source` is saved for the current user.
 */
export function PracticeSession(props: Props) {
  const { heading, children, model, source, trim, tempo: tempoScale, modelOf, sameExercise, onRestore, describe } = props;
  const { wholeLabel, backLabel } = props;
  const sourceKey = sourceKeyOf(source);
  const [error, setError] = useState<string | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [mode, setMode] = useState<Mode>({ kind: 'setup' });

  const [tracks, setTracks] = useState<number[]>(props.initialTracks);
  const opening = (): Range => {
    const [from, to] = props.initialRange ?? trim;
    const clamp = (m: number) => Math.min(Math.max(m, trim[0]), trim[1]);
    return [clamp(Math.min(from, to)), clamp(Math.max(from, to))];
  };
  const [range, setRange] = useState<Range>(opening);
  const [tempoRate, setTempoRate] = useState(props.initialTempoRate);
  const [metronome, setMetronome] = useState(true);
  const [wait, setWait] = useState(false);
  const [loop, setLoop] = useState(false);
  const [offset, setOffset] = useState(getMetronomeOffset);
  const [duel, setDuel] = useState(false);
  // Who plays at each end, and the low end's transposition, when chosen; see `duelSetup` for what is used.
  const [duelPicks, setDuelPicks] = useState<[string, string] | null>(null);
  const [duelLow, setDuelLow] = useState<number | null>(null);

  // A new exercise (a drill's settings changed) starts on the whole of it.
  useEffect(() => setRange(opening()), [trim[0], trim[1]]); // eslint-disable-line react-hooks/exhaustive-deps

  const users = useUsers();
  const userId = users.state === 'ready' ? users.current.id : null;
  const userIdRef = useRef(userId);
  userIdRef.current = userId;
  const usersRef = useRef(users);
  usersRef.current = users;
  const [kiss, setKiss] = useState(false);
  const endKiss = useCallback(() => setKiss(false), []);

  // Each player sees only their own history.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    setRuns([]);
    setMode((mode) => (mode.kind === 'playing' ? mode : { kind: 'setup' }));
    store.listRuns(sourceKey, userId).then(
      (history) => !cancelled && setRuns(history),
      () => !cancelled && setError('Practice history could not be loaded.'),
    );
    return () => {
      cancelled = true;
    };
  }, [sourceKey, userId]);

  const scores = useMemo(() => runs.map((run) => scoreRun(modelOf(run), run)), [modelOf, runs]);

  // Where each measure stands now: its accuracy the last time it was played.
  const standing = useMemo(() => {
    const values: (number | null)[] = [];
    runs.forEach((run, i) => {
      if (!sameExercise(run)) return;
      for (const m of scores[i].measures) if (m.accuracy !== null) values[m.measure] = m.accuracy;
    });
    return values;
  }, [runs, scores, sameExercise]);

  // Each pass of a loop is saved as it ends, so stopping or leaving never loses the ones before.
  const onRun = useCallback((run: Run) => {
    if (run.userId === userIdRef.current) setRuns((previous) => [...previous, run]);
    store.putRun(run).catch(() => setError('This run could not be saved. Storage may be full or blocked.'));
  }, []);
  const onEnd = useCallback((recorded: Run[]) => {
    const run = recorded.at(-1);
    const users = usersRef.current;
    if (users.state === 'ready' && earnsKiss(recorded, users.list)) setKiss(true);
    if (run?.duel) setMode({ kind: 'duel', runs: [recorded[0], run] });
    else setMode(run ? { kind: 'results', run, ...(recorded.length > 1 && { passes: recorded }) } : { kind: 'setup' });
  }, []);

  // A duel run from the history opens with the other player's run beside it, when that is still stored.
  const openRun = useCallback(
    (run: Run) => {
      const { duel } = run;
      if (!duel) return setMode({ kind: 'results', run });
      store.listRuns(sourceKey, duel.opponentId).then(
        (theirs) => {
          const other = theirs.find((r) => r.duel?.id === duel.id);
          if (!other) setMode({ kind: 'results', run });
          else setMode({ kind: 'duel', runs: duel.side === 'low' ? [run, other] : [other, run] });
        },
        () => setMode({ kind: 'results', run }),
      );
    },
    [sourceKey],
  );

  // The duel as it would start now: each end's player and where the parts go.
  const duelPitches = useMemo(
    () => expectedNotes(model, { tracks, startMeasure: range[0], endMeasure: range[1] }).map((n) => n.pitch),
    [model, tracks, range],
  );
  const layouts = useMemo(() => duelLayouts(duelPitches), [duelPitches]);

  const userList = users.state === 'ready' ? users.list : [];
  const userById = (id: string) => userList.find((u) => u.id === id);
  const nameOf = (id: string) => userById(id)?.name ?? 'A removed player';
  const duelSetup = (() => {
    if (!userId || userList.length < 2) return null;
    const low = userById(duelPicks?.[0] ?? '') ?? userById(userId)!;
    const high = userById(duelPicks?.[1] ?? '');
    const players: [User, User] = [low, high && high.id !== low.id ? high : userList.find((u) => u.id !== low.id)!];
    const layout = layouts.find((l) => l.low === duelLow) ?? defaultDuelLayout(layouts);
    return { players, layout };
  })();
  const pickDuelPlayer = (side: 0 | 1, id: string) => {
    if (!duelSetup) return;
    const picks = duelSetup.players.map((u) => u.id) as [string, string];
    // Choosing the player already at the other end swaps them over.
    if (picks[1 - side] === id) picks[1 - side] = picks[side];
    picks[side] = id;
    setDuelPicks(picks);
  };

  if (users.state === 'error') return <p className="card border-ember text-ember">{users.message}</p>;
  if (!userId) return <p className="text-haze">Loading…</p>;

  if (mode.kind === 'playing') {
    return <PracticeCanvas song={model} source={source} userId={mode.userId} config={mode.config} onRun={onRun} onEnd={onEnd} />;
  }

  if (mode.kind === 'duel') {
    const { runs: pair } = mode;
    const [low, high] = pair;
    const players = [userById(low.userId), userById(high.userId)];
    const replay = sameExercise(low) && players[0] && players[1];
    return (
      <div className="space-y-6">
        {kiss && <KissShower onDone={endKiss} />}
        {error && <p className="card border-ember text-sm text-ember">{error}</p>}
        <DuelResults
          key={low.id}
          runs={pair}
          scores={[scoreRun(modelOf(low), low), scoreRun(modelOf(high), high)]}
          names={[nameOf(low.userId), nameOf(high.userId)]}
          backLabel={backLabel}
          onRematch={
            replay
              ? (swap) =>
                  setMode({
                    kind: 'playing',
                    userId,
                    config: {
                      tracks: low.tracks,
                      startMeasure: low.startMeasure,
                      endMeasure: low.endMeasure,
                      tempoRate: low.tempoRate,
                      metronome: low.metronome,
                      wait: false,
                      loop: false,
                      duel: {
                        players: swap ? [players[1]!, players[0]!] : [players[0]!, players[1]!],
                        layout: { low: low.transpose ?? 0, high: high.transpose ?? 0 },
                      },
                    },
                  })
              : undefined
          }
          onBack={() => setMode({ kind: 'setup' })}
        />
      </div>
    );
  }

  if (mode.kind === 'results') {
    const { run, passes } = mode;
    const same = sameExercise(run);
    return (
      <div className="space-y-6">
        {kiss && <KissShower onDone={endKiss} />}
        {error && <p className="card border-ember text-sm text-ember">{error}</p>}
        {passes && (
          <section className="card space-y-3">
            <h2 className="eyebrow">Looped {passes.length} times · choose a pass</h2>
            <div className="flex flex-wrap gap-2">
              {passes.map((pass, i) => {
                const accuracy = scores[runs.indexOf(pass)]?.accuracy ?? null;
                return (
                  <button
                    key={pass.id}
                    type="button"
                    className={`btn ${pass === run ? 'btn-primary' : ''}`}
                    aria-pressed={pass === run}
                    onClick={() => setMode({ kind: 'results', run: pass, passes })}
                  >
                    {i + 1}
                    <span
                      className={`ml-2 rounded-block px-1.5 font-semibold ${accuracy === null ? '' : 'text-night'}`}
                      style={accuracy === null ? undefined : { background: heatColor(accuracy) }}
                    >
                      {percent(accuracy)}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        )}
        <Results
          key={run.id}
          run={run}
          score={scoreRun(modelOf(run), run)}
          backLabel={backLabel}
          onPractice={
            same
              ? (section) => {
                  setRange(section);
                  setMode({ kind: 'setup' });
                }
              : undefined
          }
          onAgain={
            same
              ? () =>
                  setMode({
                    kind: 'playing',
                    userId,
                    config: {
                      tracks: run.tracks,
                      startMeasure: run.startMeasure,
                      endMeasure: run.endMeasure,
                      tempoRate: run.tempoRate,
                      metronome: run.metronome,
                      wait: !!run.wait,
                      loop: run.pass !== undefined,
                    },
                  })
              : undefined
          }
          onRestore={
            !same && onRestore
              ? () => {
                  onRestore(run);
                  setMode({ kind: 'setup' });
                }
              : undefined
          }
          onBack={() => setMode({ kind: 'setup' })}
        />
      </div>
    );
  }

  const whole = range[0] === trim[0] && range[1] === trim[1];
  const dueling = duel && duelSetup !== null && duelSetup.layout !== null;
  const start = () =>
    setMode({
      kind: 'playing',
      userId,
      config: {
        tracks,
        startMeasure: range[0],
        endMeasure: range[1],
        tempoRate,
        metronome,
        // A duel plays once at a steady tempo, so neither player can hold the music for both.
        wait: wait && !duel,
        loop: loop && !duel,
        ...(dueling && { duel: { players: duelSetup.players, layout: duelSetup.layout! } }),
      },
    });

  return (
    <div className="space-y-6">
      {heading}
      {error && <p className="card border-ember text-sm text-ember">{error}</p>}
      {children}

      <section className="card space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="title text-2xl">{whole ? wholeLabel : `Measures ${range[0] + 1}–${range[1] + 1}`}</h2>
          {!whole && (
            <button type="button" className="btn" onClick={() => setRange(trim)}>
              Select {wholeLabel.toLowerCase()}
            </button>
          )}
        </div>
        <p className="text-sm text-haze">
          Tap the first and last measure, or drag across them, to practice one section. Colours show how each measure went the last
          time you played it.
        </p>
        <HeatStrip from={trim[0]} to={trim[1]} values={standing} selection={range} onSelect={setRange} />
      </section>

      <section className="card grid gap-6 sm:grid-cols-3">
        <fieldset className="space-y-2">
          <legend className="eyebrow mb-2">Parts to play</legend>
          {model.tracks.map((track) => (
            <label key={track.index} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={tracks.includes(track.index)}
                onChange={(e) =>
                  setTracks(e.target.checked ? [...tracks, track.index] : tracks.filter((t) => t !== track.index))
                }
              />
              <span>{track.name}</span>
              <span className="text-haze">{track.noteCount} notes</span>
            </label>
          ))}
        </fieldset>

        <div className="space-y-2">
          <label className="block space-y-2">
            <span className="eyebrow">Tempo</span>
            <span className="block font-display text-2xl">{tempoScale.label(tempoRate)}</span>
            <input
              type="range"
              className="w-full"
              min={tempoScale.min}
              max={tempoScale.max}
              step={tempoScale.step}
              value={tempoRate}
              onChange={(e) => setTempoRate(Number(e.target.value))}
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={wait && !duel} disabled={duel} onChange={(e) => setWait(e.target.checked)} />
            Wait for each note{duel ? ' (off in a duel)' : ''}
          </label>
          <p className="text-xs text-haze">The music stops at every note until you play it.</p>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={loop && !duel} disabled={duel} onChange={(e) => setLoop(e.target.checked)} />
            Loop the section{duel ? ' (off in a duel)' : ''}
          </label>
          <p className="text-xs text-haze">Plays it over and over until you stop. Each pass is scored.</p>
        </div>

        <div className="space-y-2">
          <p className="eyebrow">Metronome</p>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={metronome && !(wait && !duel)}
              disabled={wait && !duel}
              onChange={(e) => setMetronome(e.target.checked)}
            />
            Click on every beat{wait && !duel ? ' (off while waiting for notes)' : ''}
          </label>
          <label className="flex items-center gap-2 text-sm text-haze">
            Play clicks
            <input
              type="number"
              className="w-20 rounded-block border-2 border-rule bg-night px-2 py-1 text-snow"
              min={0}
              max={500}
              step={10}
              value={offset}
              onChange={(e) => {
                const ms = Math.max(0, Number(e.target.value) || 0);
                setOffset(ms);
                setMetronomeOffset(ms);
              }}
            />
            ms early
          </label>
          <p className="text-xs text-haze">Raise this if clicks sound late, as they can over Bluetooth.</p>
        </div>
      </section>

      <section className="card space-y-4">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={duel} onChange={(e) => setDuel(e.target.checked)} />
          <span className="title text-2xl">Duel</span>
        </label>
        <p className="text-sm text-haze">
          Two players at one keyboard play the same parts, one at each end, and the better score wins. Each player&apos;s run
          is saved to their own history. The music plays through once, without waiting or looping.
        </p>
        {duel && !duelSetup && (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span>A duel needs a second player.</span>
            <Link href="/players" className="btn">
              Add a player
            </Link>
          </div>
        )}
        {duel && duelSetup && (
          <div className="grid gap-4 sm:grid-cols-3">
            {(['Low end', 'High end'] as const).map((label, side) => (
              <label key={label} className="block space-y-2">
                <span className="eyebrow">{label}</span>
                <select
                  className="block w-full rounded-block border-2 border-rule bg-night px-2 py-1 text-snow"
                  value={duelSetup.players[side].id}
                  onChange={(e) => pickDuelPlayer(side as 0 | 1, e.target.value)}
                >
                  {userList.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <label className="block space-y-2">
              <span className="eyebrow">Keys</span>
              {duelSetup.layout ? (
                <select
                  className="block w-full rounded-block border-2 border-rule bg-night px-2 py-1 text-snow"
                  value={duelSetup.layout.low}
                  onChange={(e) => setDuelLow(Number(e.target.value))}
                >
                  {layouts.map((layout) => (
                    <option key={layout.low} value={layout.low}>
                      {duelRange(duelPitches, layout.low)} and {duelRange(duelPitches, layout.high)}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="block text-sm text-ember">
                  {duelPitches.length
                    ? 'These parts cover too many keys to fit twice on a keyboard. Choose fewer parts or a shorter section.'
                    : 'Choose a part to play.'}
                </span>
              )}
            </label>
          </div>
        )}
      </section>

      <button
        type="button"
        className="btn btn-primary px-8 py-3 text-base"
        disabled={!tracks.some((t) => model.tracks.some((track) => track.index === t)) || (duel && !dueling)}
        onClick={start}
      >
        {duel ? 'Start the duel' : 'Start practice'}
      </button>

      <section className="card space-y-2">
        <h2 className="title text-2xl">History</h2>
        <RunHistory runs={runs} scores={scores} describe={describe} nameOf={nameOf} onOpen={openRun} />
      </section>
    </div>
  );
}
