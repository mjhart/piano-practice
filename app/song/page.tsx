'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { parseMidi } from '../lib/midi/parse';
import { buildSongModel } from '../lib/midi/songModel';
import { MAX_TEMPO_RATE, MIN_TEMPO_RATE, resolveSettings } from '../lib/settings';
import { store } from '../lib/store';
import type { RunSource, SongModel, SongSettings } from '../types';
import { PracticeSession } from './components/PracticeSession';

type Loaded = { title: string; model: SongModel; settings: SongSettings };

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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const song = await store.getSong(id);
        if (!song) throw new Error('This piece is not in your library.');
        const model = buildSongModel(parseMidi(song.midi));
        if (cancelled) return;
        setLoaded({ title: song.title, model, settings: resolveSettings(model, song.settings) });
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load this piece.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const source = useMemo<RunSource>(() => ({ kind: 'song', songId: id }), [id]);
  const model = loaded?.model;
  // Every run of a piece played the same notes, whatever its trim.
  const modelOf = useCallback(() => model!, [model]);
  const sameExercise = useCallback(() => true, []);

  if (error) {
    return (
      <div className="space-y-4">
        <p className="card border-ember text-ember">{error}</p>
        <Link href="/" className="btn">
          Back to the library
        </Link>
      </div>
    );
  }
  if (!loaded || !model) return <p className="text-haze">Loading…</p>;

  const { settings } = loaded;
  return (
    <PracticeSession
      heading={
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="eyebrow">
              {settings.lastMeasure - settings.firstMeasure + 1} measures · {Math.round(model.bpm)} bpm
            </p>
            <h1 className="title mt-2 text-4xl sm:text-5xl">{loaded.title}</h1>
          </div>
          <Link href={`/song/setup?id=${id}`} className="btn">
            Set up
          </Link>
        </div>
      }
      model={model}
      source={source}
      trim={[settings.firstMeasure, settings.lastMeasure]}
      initialTracks={settings.tracks}
      initialTempoRate={settings.tempoRate}
      tempo={{
        min: MIN_TEMPO_RATE,
        max: MAX_TEMPO_RATE,
        step: 0.01,
        label: (rate) => (
          <>
            {Math.round(rate * 100)}% <span className="font-body text-base text-haze">{Math.round(model.bpm * rate)} bpm</span>
          </>
        ),
      }}
      modelOf={modelOf}
      sameExercise={sameExercise}
      wholeLabel="Whole piece"
      backLabel="Back to the piece"
    />
  );
}
