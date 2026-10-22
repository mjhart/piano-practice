'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { findDrill } from '../lib/drills/registry';
import { pitchName } from '../lib/drills/theory';
import { parseMidi } from '../lib/midi/parse';
import { buildSongModel } from '../lib/midi/songModel';
import { resolveSettings } from '../lib/settings';
import { tempoText } from '../lib/sources';
import {
  addDays,
  analyzeRun,
  CLEAN_ACCURACY,
  dailyTrend,
  dayKey,
  duelRecords,
  keyboard,
  practiceByDay,
  progressBySource,
  streaks,
  tagBreakdown,
  totals,
  weakSections,
  type KeyTally,
  type RunStats,
} from '../lib/stats';
import { store } from '../lib/store';
import { useUsers } from '../lib/users';
import { heatColor } from '../song/components/HeatStrip';
import { percent, TAG_HEADINGS } from '../song/components/Results';
import type { Run, SongModel } from '../types';
import { Calendar } from './Calendar';
import { duration, shortDate } from './format';
import { KeyboardMap } from './KeyboardMap';
import { TrendChart } from './TrendChart';

// A player's statistics: how much they practise, how it is going, and where
// to put the next half hour. Everything is worked out from their stored runs.

type SongInfo = { title: string; range: [number, number] };

type Loaded = {
  userId: string;
  /** The player's runs, oldest first. */
  mine: RunStats[];
  /** The other side of each of their duels. */
  theirs: RunStats[];
  songs: Map<string, SongInfo>;
  today: string;
};

const PERIODS = [
  { id: 'week', label: '7 days', days: 7 },
  { id: 'month', label: '30 days', days: 30 },
  { id: 'all', label: 'All time', days: null },
] as const;
type Period = (typeof PERIODS)[number]['id'];

/** Scores every run of `userId`, and of their duel opponents, against what each one played. */
async function load(userId: string): Promise<Loaded> {
  const runs = await store.listUserRuns(userId);
  const songs = new Map<string, SongInfo>();
  const models = new Map<string, SongModel>();
  const songIds = new Set(runs.flatMap((r) => (r.source.kind === 'song' ? [r.source.songId] : [])));
  await Promise.all(
    [...songIds].map(async (id) => {
      const song = await store.getSong(id);
      if (!song) return;
      try {
        const model = buildSongModel(parseMidi(song.midi));
        const settings = resolveSettings(model, song.settings);
        models.set(id, model);
        songs.set(id, { title: song.title, range: [settings.firstMeasure, settings.lastMeasure] });
      } catch {
        // A file that no longer reads is left out rather than spoiling the page.
      }
    }),
  );
  const modelOf = (run: Run) => (run.source.kind === 'drill' ? run.source.exercise : models.get(run.source.songId));
  const analyze = (list: Run[]) =>
    list.flatMap((run) => {
      const model = modelOf(run);
      return model ? [analyzeRun(model, run)] : [];
    });

  const duelIds = new Set(runs.flatMap((r) => (r.duel ? [r.duel.id] : [])));
  const opponents = [...new Set(runs.flatMap((r) => (r.duel ? [r.duel.opponentId] : [])))];
  const theirRuns = (await Promise.all(opponents.map((id) => store.listUserRuns(id)))).flat();
  return {
    userId,
    mine: analyze(runs),
    theirs: analyze(theirRuns.filter((r) => r.duel && duelIds.has(r.duel.id))),
    songs,
    today: dayKey(Date.now()),
  };
}

export default function StatsPage() {
  const users = useUsers();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period>('month');
  const userId = users.state === 'ready' ? users.current.id : null;

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    setError(null);
    load(userId).then(
      (result) => !cancelled && setLoaded(result),
      () => !cancelled && setError('Practice history could not be loaded.'),
    );
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (users.state === 'error') return <p className="card border-ember text-ember">{users.message}</p>;
  if (error) return <p className="card border-ember text-ember">{error}</p>;
  if (users.state === 'loading' || !loaded || loaded.userId !== userId) return <p className="text-haze">Loading…</p>;
  const nameOf = (id: string) => users.list.find((u) => u.id === id)?.name ?? 'a removed player';

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="eyebrow">Statistics</p>
          <h1 className="title mt-2 text-4xl sm:text-5xl">{users.current.name}’s playing</h1>
        </div>
        <Link href="/" className="btn">
          Back to the library
        </Link>
      </div>
      {loaded.mine.length === 0 ? (
        <p className="card text-haze">
          No practice yet. Play a piece or a drill and your statistics will start here.
        </p>
      ) : (
        <Stats loaded={loaded} period={period} setPeriod={setPeriod} nameOf={nameOf} />
      )}
    </div>
  );
}

function Stats({
  loaded,
  period,
  setPeriod,
  nameOf,
}: {
  loaded: Loaded;
  period: Period;
  setPeriod: (period: Period) => void;
  nameOf: (userId: string) => string;
}) {
  const { mine, theirs, songs, today } = loaded;
  const days = PERIODS.find((p) => p.id === period)!.days;
  const since = days === null ? '' : addDays(today, 1 - days);
  const inPeriod = useMemo(() => mine.filter((s) => dayKey(s.run.startedAt) >= since), [mine, since]);

  const byDay = useMemo(() => practiceByDay(mine), [mine]);
  const streak = useMemo(() => streaks(byDay.keys(), today), [byDay, today]);
  const sum = useMemo(() => totals(inPeriod), [inPeriod]);
  const trend = useMemo(() => dailyTrend(inPeriod), [inPeriod]);
  const keys = useMemo(() => keyboard(inPeriod), [inPeriod]);
  const progress = useMemo(() => progressBySource(inPeriod), [inPeriod]);
  const duels = useMemo(() => duelRecords(inPeriod, theirs), [inPeriod, theirs]);

  const titleOf = (run: Run) =>
    run.source.kind === 'song'
      ? (songs.get(run.source.songId)?.title ?? 'A removed piece')
      : (findDrill(run.source.drillId)?.name ?? 'A drill');
  const linkOf = (run: Run) => (run.source.kind === 'song' ? `/song?id=${run.source.songId}` : `/drill?id=${run.source.drillId}`);
  const firstRun = (sourceKey: string) => inPeriod.find((s) => s.run.sourceKey === sourceKey)!.run;

  // Sections of pieces that went badly lately, across every piece, worst first.
  const trouble = useMemo(() => {
    const bySong = new Map<string, RunStats[]>();
    for (const s of inPeriod) {
      if (s.run.source.kind !== 'song' || s.run.duel) continue;
      bySong.set(s.run.source.songId, [...(bySong.get(s.run.source.songId) ?? []), s]);
    }
    return [...bySong]
      .flatMap(([songId, list]) => {
        const info = songs.get(songId);
        return info ? weakSections(list, info.range).map((section) => ({ songId, title: info.title, ...section })) : [];
      })
      .sort((a, b) => a.accuracy - b.accuracy)
      .slice(0, 6);
  }, [inPeriod, songs]);

  const drillGroups = useMemo(() => {
    const byDrill = new Map<string, RunStats[]>();
    for (const s of inPeriod) {
      if (s.run.source.kind === 'drill') byDrill.set(s.run.source.drillId, [...(byDrill.get(s.run.source.drillId) ?? []), s]);
    }
    return [...byDrill].map(([drillId, list]) => ({
      drillId,
      runs: list.length,
      tags: tagBreakdown(list).filter((g) => g.values.length > 1),
    }));
  }, [inPeriod]);

  const tendency =
    sum.meanErrorMs === null
      ? '–'
      : Math.abs(sum.meanErrorMs) < 10
        ? 'On the beat'
        : `${Math.round(Math.abs(sum.meanErrorMs))} ms ${sum.meanErrorMs > 0 ? 'late' : 'early'}`;
  const accuracyPoints = trend.flatMap((p) => (p.accuracy === null ? [] : [{ day: p.day, value: p.accuracy }]));
  const timingPoints = trend.flatMap((p) => (p.meanAbsErrorMs === null ? [] : [{ day: p.day, value: p.meanAbsErrorMs }]));
  const timingMax = Math.max(150, ...timingPoints.map((p) => Math.ceil(p.value / 50) * 50));

  return (
    <>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Period">
        {PERIODS.map((p) => (
          <button
            key={p.id}
            type="button"
            aria-pressed={period === p.id}
            className={`btn ${period === p.id ? 'btn-primary' : ''}`}
            onClick={() => setPeriod(p.id)}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="card grid grid-cols-2 gap-5 sm:grid-cols-3">
        <Tile label="Time at the keys" value={duration(sum.ms)} note={`${sum.runs} ${sum.runs === 1 ? 'run' : 'runs'}`} />
        <Tile label="Days practised" value={String(sum.days)} note={days === null ? 'since you started' : `of the last ${days}`} />
        <Tile
          label="Streak"
          value={`${streak.current} ${streak.current === 1 ? 'day' : 'days'}`}
          note={`best ${streak.longest}${byDay.has(today) || streak.current === 0 ? '' : ' · play today to keep it'}`}
        />
        <Tile label="Accuracy" value={percent(sum.accuracy)} note="every note, all runs" />
        <Tile label="Notes hit" value={sum.hits.toLocaleString()} note={`${sum.misses} missed, ${sum.extras} wrong`} />
        <Tile
          label="Timing"
          value={sum.meanAbsErrorMs === null ? '–' : `±${Math.round(sum.meanAbsErrorMs)} ms`}
          note={tendency === '–' ? 'not timed in wait mode' : tendency.toLowerCase()}
        />
      </div>

      <section className="card space-y-4">
        <Heading title="Practice calendar" note="The last 20 weeks. Brighter days had more practice." />
        <Calendar days={byDay} today={today} />
      </section>

      {inPeriod.length === 0 ? (
        <p className="card text-haze">No practice in the last {days} days. Pick a longer period to see more.</p>
      ) : (
        <>
          <section className="card space-y-4">
            <Heading title="Accuracy" note="Each practice day, all runs together." />
            {accuracyPoints.length > 0 ? (
              <TrendChart
                points={accuracyPoints}
                max={1}
                ticks={[0, 0.5, 1]}
                format={(v) => `${Math.round(v * 100)}%`}
                label="accuracy"
              />
            ) : (
              <p className="text-sm text-haze">Nothing scored yet.</p>
            )}
            {timingPoints.length > 1 && (
              <>
                <Heading
                  title="Timing"
                  note="How far from the beat hit notes landed each day, in milliseconds. Lower is steadier. Wait mode isn’t timed."
                />
                <TrendChart
                  points={timingPoints}
                  max={timingMax}
                  ticks={[0, timingMax / 2, timingMax]}
                  format={(v) => `${Math.round(v)} ms`}
                  label="off the beat"
                  height={140}
                />
              </>
            )}
            {sum.waitPerNoteMs !== null && (
              <p className="text-sm">
                <span className="text-haze">In wait mode the music waited</span> {(sum.waitPerNoteMs / 1000).toFixed(2)} s{' '}
                <span className="text-haze">per note on average. Less is quicker reading.</span>
              </p>
            )}
          </section>

          {keys.length > 0 && (
            <section className="card space-y-4">
              <Heading title="Your keyboard" note="Every key you had notes on, coloured by how many of them you hit." />
              <KeyboardMap keys={keys} />
              <KeyLists keys={keys} />
            </section>
          )}

          <section className="card space-y-4">
            <Heading title="Pieces and drills" note="Most recently played first." />
            <ul className="divide-y divide-rule">
              {progress.map((p) => {
                const run = firstRun(p.sourceKey);
                return (
                  <li key={p.sourceKey} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
                    <div className="min-w-0 flex-1 basis-56">
                      <Link href={linkOf(run)} className="block truncate font-display text-lg uppercase hover:text-gold">
                        {titleOf(run)}
                      </Link>
                      <p className="text-sm text-haze">
                        {p.runs} {p.runs === 1 ? 'run' : 'runs'} · {duration(p.ms)} · last {shortDate(p.lastPlayed)}
                        {p.fastestClean &&
                          ` · ${Math.round(CLEAN_ACCURACY * 100)}%+ at ${tempoText(p.fastestClean.source, p.fastestClean.tempoRate)}`}
                      </p>
                    </div>
                    <Sparkline values={p.recent} />
                    <div className="w-24 text-right">
                      <p className="title text-xl">{percent(p.best)}</p>
                      <p className="text-xs text-haze">
                        best
                        {p.change !== null &&
                          Math.round(p.change * 100) !== 0 &&
                          ` · ${p.change > 0 ? '+' : '−'}${Math.abs(Math.round(p.change * 100))} pts`}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>

          {trouble.length > 0 && (
            <section className="card space-y-4">
              <Heading
                title="Trouble spots"
                note="Measures in your pieces that have gone worst over their last five plays. Practice one straight from here."
              />
              <ul className="divide-y divide-rule">
                {trouble.map((t) => (
                  <li key={`${t.songId}:${t.from}`} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
                    <span
                      className="w-14 rounded-block px-2 py-1 text-center text-sm font-semibold text-night"
                      style={{ background: heatColor(t.accuracy) }}
                    >
                      {percent(t.accuracy)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{t.title}</span>
                      <span className="text-sm text-haze">
                        {t.from === t.to ? `Measure ${t.from + 1}` : `Measures ${t.from + 1}–${t.to + 1}`}
                      </span>
                    </span>
                    <Link href={`/song?id=${t.songId}&from=${t.from + 1}&to=${t.to + 1}`} className="btn">
                      Practice
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {drillGroups.some((g) => g.tags.length > 0) && (
            <section className="card space-y-6">
              <Heading title="Drills in detail" note="Every run of each drill added up, weakest first." />
              {drillGroups
                .filter((g) => g.tags.length > 0)
                .map((g) => (
                  <div key={g.drillId} className="space-y-3">
                    <h3 className="font-display text-lg uppercase">
                      {findDrill(g.drillId)?.name ?? g.drillId}{' '}
                      <span className="font-body text-sm text-haze normal-case">
                        {g.runs} {g.runs === 1 ? 'run' : 'runs'}
                      </span>
                    </h3>
                    {g.tags.map(({ tag, values }) => (
                      <div key={tag} className="space-y-2">
                        <p className="eyebrow">{TAG_HEADINGS[tag] ?? `By ${tag}`}</p>
                        <div className="flex flex-wrap gap-2">
                          {values.map((v) => (
                            <span
                              key={v.value}
                              className={`rounded-block px-2 py-1 text-sm font-semibold ${v.accuracy === null ? '' : 'text-night'}`}
                              style={v.accuracy === null ? undefined : { background: heatColor(v.accuracy) }}
                            >
                              {v.value} {percent(v.accuracy)}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
            </section>
          )}

          {duels.length > 0 && (
            <section className="card space-y-4">
              <Heading title="Duels" note="Won on accuracy, then notes hit, then steadier timing." />
              <ul className="divide-y divide-rule">
                {duels.map((d) => (
                  <li key={d.opponentId} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3">
                    <span>Against {nameOf(d.opponentId)}</span>
                    <span className="font-display tracking-wider uppercase">
                      <span className="text-gold">{d.wins} won</span> · {d.losses} lost
                      {d.draws ? ` · ${d.draws} drawn` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </>
  );
}

function Heading({ title, note }: { title: string; note: string }) {
  return (
    <div>
      <h2 className="title text-2xl">{title}</h2>
      <p className="mt-2 text-sm text-haze">{note}</p>
    </div>
  );
}

function Tile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="min-w-0">
      <p className="eyebrow">{label}</p>
      <p className="title mt-1 text-3xl">{value}</p>
      <p className="mt-1 text-xs text-haze">{note}</p>
    </div>
  );
}

/** One bar per recent run, as tall and as warm as it was accurate. */
function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  return (
    <div className="flex h-8 w-28 items-end gap-[2px]" role="img" aria-label={`Recent runs: ${values.map((v) => percent(v)).join(', ')}`}>
      {values.map((v, i) => (
        <span
          key={i}
          className="min-w-0 flex-1 rounded-t-[2px]"
          style={{ height: `${Math.max(v, 0.06) * 100}%`, background: heatColor(v) }}
        />
      ))}
    </div>
  );
}

/** Keys with fewer notes than this are too few to call often missed. */
const MIN_NOTES = 5;

/** The keys missed most often, and the ones pressed most by mistake. */
function KeyLists({ keys }: { keys: KeyTally[] }) {
  const missed = keys
    .filter((k) => k.hits + k.misses >= MIN_NOTES && k.misses > 0)
    .sort((a, b) => b.misses / (b.hits + b.misses) - a.misses / (a.hits + a.misses))
    .slice(0, 5);
  const wrong = keys
    .filter((k) => k.wrong > 0)
    .sort((a, b) => b.wrong - a.wrong)
    .slice(0, 5);
  if (missed.length === 0 && wrong.length === 0) return null;
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      {missed.length > 0 && (
        <div className="space-y-2">
          <p className="eyebrow">Missed most often</p>
          <ul className="space-y-1 text-sm">
            {missed.map((k) => (
              <li key={k.pitch} className="flex justify-between gap-4">
                <span className="font-semibold">{pitchName(k.pitch)}</span>
                <span className="text-haze">
                  {k.misses} of {k.hits + k.misses} missed
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {wrong.length > 0 && (
        <div className="space-y-2">
          <p className="eyebrow">Pressed by mistake</p>
          <ul className="space-y-1 text-sm">
            {wrong.map((k) => (
              <li key={k.pitch} className="flex justify-between gap-4">
                <span className="font-semibold">{pitchName(k.pitch)}</span>
                <span className="text-haze">
                  {k.wrong} {k.wrong === 1 ? 'time' : 'times'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
