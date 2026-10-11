'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { heatColor } from './components/HeatStrip';
import { parseMidi } from '../lib/midi/parse';
import { buildSongModel } from '../lib/midi/songModel';
import { getMetronomeOffset, setMetronomeOffset } from '../lib/prefs';
import { scoreRun } from '../lib/scoring';
import { MAX_TEMPO_RATE, MIN_TEMPO_RATE, resolveSettings } from '../lib/settings';
import { store } from '../lib/store';
import type { Run, SongModel } from '../types';
import { HeatStrip } from './components/HeatStrip';
import { PracticeCanvas, type PracticeConfig } from './components/PracticeCanvas';
import { Results, percent } from './components/Results';
import { RunHistory } from './components/RunHistory';

type Range = [number, number];

type Mode =
  | { kind: 'setup' }
  | { kind: 'playing'; config: PracticeConfig }
  /** `passes` holds every pass of a loop, oldest first, when there was more than one. */
  | { kind: 'results'; run: Run; passes?: Run[] };

/** `trim` is the part of the piece kept in its settings, as inclusive measure indexes. */
type Loaded = { title: string; model: SongModel; trim: Range };

export default function SongPage() {
  return (
    <Suspense>
      <SongView />
    </Suspense>
  );
}

function SongView() {
  const id = useSearchParams().get('id') ?? '';
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [mode, setMode] = useState<Mode>({ kind: 'setup' });

  const [tracks, setTracks] = useState<number[]>([]);
  const [range, setRange] = useState<Range>([0, 0]);
  const [tempo, setTempo] = useState(100);
  const [metronome, setMetronome] = useState(true);
  const [wait, setWait] = useState(false);
  const [loop, setLoop] = useState(false);
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const song = await store.getSong(id);
        if (!song) throw new Error('This piece is not in your library.');
        const model = buildSongModel(parseMidi(song.midi));
        const history = await store.listRuns(id);
        if (cancelled) return;
        const settings = resolveSettings(model, song.settings);
        const trim: Range = [settings.firstMeasure, settings.lastMeasure];
        setLoaded({ title: song.title, model, trim });
        setRuns(history);
        setTracks(settings.tracks);
        setRange(trim);
        setTempo(Math.round(settings.tempoRate * 100));
        setOffset(getMetronomeOffset());
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load this piece.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const model = loaded?.model;
  const scores = useMemo(() => (model ? runs.map((run) => scoreRun(model, run)) : []), [model, runs]);

  // Where each measure stands now: its accuracy the last time it was played.
  const standing = useMemo(() => {
    const values: (number | null)[] = [];
    for (const score of scores) {
      for (const m of score.measures) if (m.accuracy !== null) values[m.measure] = m.accuracy;
    }
    return values;
  }, [scores]);

  // Each pass of a loop is saved as it ends, so stopping or leaving never loses the ones before.
  const onRun = useCallback((run: Run) => {
    setRuns((previous) => [...previous, run]);
    store.putRun(run).catch(() => setError('This run could not be saved. Storage may be full or blocked.'));
  }, []);
  const onEnd = useCallback((recorded: Run[]) => {
    const run = recorded.at(-1);
    setMode(run ? { kind: 'results', run, ...(recorded.length > 1 && { passes: recorded }) } : { kind: 'setup' });
  }, []);

  if (error && !model) {
    return (
      <div className="space-y-4">
        <p className="card border-ember text-ember">{error}</p>
        <Link href="/" className="btn">
          Back to the library
        </Link>
      </div>
    );
  }
  if (!model || !loaded) return <p className="text-haze">Loading…</p>;

  if (mode.kind === 'playing') {
    return <PracticeCanvas song={model} songId={id} config={mode.config} onRun={onRun} onEnd={onEnd} />;
  }

  if (mode.kind === 'results') {
    const { run, passes } = mode;
    return (
      <div className="space-y-6">
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
          score={scoreRun(model, run)}
          onPractice={(section) => {
            setRange(section);
            setMode({ kind: 'setup' });
          }}
          onAgain={() =>
            setMode({
              kind: 'playing',
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
          }
          onBack={() => setMode({ kind: 'setup' })}
        />
      </div>
    );
  }

  const { trim } = loaded;
  const wholeSong = range[0] === trim[0] && range[1] === trim[1];
  const start = () =>
    setMode({
      kind: 'playing',
      config: { tracks, startMeasure: range[0], endMeasure: range[1], tempoRate: tempo / 100, metronome, wait, loop },
    });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="eyebrow">
            {trim[1] - trim[0] + 1} measures · {Math.round(model.bpm)} bpm
          </p>
          <h1 className="title mt-2 text-4xl sm:text-5xl">{loaded.title}</h1>
        </div>
        <Link href={`/song/setup?id=${id}`} className="btn">
          Set up
        </Link>
      </div>

      <section className="card space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="title text-2xl">
            {wholeSong ? 'Whole piece' : `Measures ${range[0] + 1}–${range[1] + 1}`}
          </h2>
          {!wholeSong && (
            <button type="button" className="btn" onClick={() => setRange(trim)}>
              Select the whole piece
            </button>
          )}
        </div>
        <p className="text-sm text-haze">
          Drag across measures, or shift-click, to practice one section. Colours show how each measure went the last
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
            <span className="block font-display text-2xl">
              {tempo}% <span className="font-body text-base text-haze">{Math.round((model.bpm * tempo) / 100)} bpm</span>
            </span>
            <input
              type="range"
              className="w-full"
              min={MIN_TEMPO_RATE * 100}
              max={MAX_TEMPO_RATE * 100}
              step={1}
              value={tempo}
              onChange={(e) => setTempo(Number(e.target.value))}
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={wait} onChange={(e) => setWait(e.target.checked)} />
            Wait for each note
          </label>
          <p className="text-xs text-haze">The music stops at every note until you play it.</p>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} />
            Loop the section
          </label>
          <p className="text-xs text-haze">Plays it over and over until you stop. Each pass is scored.</p>
        </div>

        <div className="space-y-2">
          <p className="eyebrow">Metronome</p>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={metronome && !wait}
              disabled={wait}
              onChange={(e) => setMetronome(e.target.checked)}
            />
            Click on every beat{wait ? ' (off while waiting for notes)' : ''}
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

      <button type="button" className="btn btn-primary px-8 py-3 text-base" disabled={tracks.length === 0} onClick={start}>
        Start practice
      </button>

      <section className="card space-y-2">
        <h2 className="title text-2xl">History</h2>
        <RunHistory runs={runs} scores={scores} onOpen={(run) => setMode({ kind: 'results', run })} />
      </section>
    </div>
  );
}
