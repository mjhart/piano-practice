'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parseMidi } from '../../lib/midi/parse';
import { buildSongModel } from '../../lib/midi/songModel';
import { MAX_TEMPO_RATE, MIN_TEMPO_RATE, measureSpan, resolveSettings } from '../../lib/settings';
import { store } from '../../lib/store';
import { NotePlayer } from '../../lib/synth';
import type { Song, SongModel } from '../../types';
import { TRACK_COLORS } from '../components/PracticeCanvas';
import { TrackPreview } from '../components/TrackPreview';

const NOTE_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const pitchName = (pitch: number) => `${NOTE_NAMES[pitch % 12]}${Math.floor(pitch / 12) - 1}`;

const clock = (seconds: number) => {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
};

export default function SetupPage() {
  return (
    <Suspense>
      <SetupView />
    </Suspense>
  );
}

function SetupView() {
  const id = useSearchParams().get('id') ?? '';
  const router = useRouter();
  const [loaded, setLoaded] = useState<{ song: Song; model: SongModel } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [tracks, setTracks] = useState<number[]>([]);
  const [tempo, setTempo] = useState(100);
  const [trim, setTrim] = useState<[number, number]>([0, 0]);
  /** Song time that playback starts from. */
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const player = useRef<NotePlayer | null>(null);
  const clockRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const song = await store.getSong(id);
        if (!song) throw new Error('This piece is not in your library.');
        const model = buildSongModel(parseMidi(song.midi));
        if (cancelled) return;
        const settings = resolveSettings(model, song.settings);
        setLoaded({ song, model });
        setTitle(song.title);
        setTracks(settings.tracks);
        setTempo(Math.round(settings.tempoRate * 100));
        setTrim([settings.firstMeasure, settings.lastMeasure]);
        setCursor(model.measures[settings.firstMeasure].start);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load this piece.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const stop = useCallback(() => {
    player.current?.stop();
    player.current = null;
    setPlaying(false);
  }, []);
  useEffect(() => stop, [stop]);

  const model = loaded?.model;
  const colors = useMemo(
    () => new Map(model?.tracks.map((t, i) => [t.index, TRACK_COLORS[i % TRACK_COLORS.length]])),
    [model],
  );
  const ranges = useMemo(() => {
    const byTrack = new Map<number, [number, number]>();
    for (const n of model?.notes ?? []) {
      const range = byTrack.get(n.track);
      if (!range) byTrack.set(n.track, [n.pitch, n.pitch]);
      else {
        range[0] = Math.min(range[0], n.pitch);
        range[1] = Math.max(range[1], n.pitch);
      }
    }
    return byTrack;
  }, [model]);

  const trimStart = model ? model.measures[trim[0]].start : 0;
  const trimEnd = model ? model.measures[trim[1]].end : 0;
  // Playback always stays inside the part of the piece that is kept.
  const startTime = cursor >= trimStart && cursor < trimEnd ? cursor : trimStart;

  const position = useCallback(() => {
    const time = player.current?.position() ?? startTime;
    if (clockRef.current) clockRef.current.textContent = clock(time);
    return time;
  }, [startTime]);

  if (error && !loaded) {
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

  const playFrom = (time: number, parts = tracks, percent = tempo) => {
    player.current?.stop();
    const wanted = new Set(parts);
    const notes = model.notes.filter((n) => wanted.has(n.track));
    const drums = new Set(model.tracks.filter((t) => t.percussion).map((t) => t.index));
    player.current = new NotePlayer(notes, drums, time, trimEnd, percent / 100, () => {
      player.current = null;
      setPlaying(false);
    });
    setPlaying(true);
  };
  // Changes made while listening take effect straight away, from the same spot.
  const chooseTracks = (next: number[]) => {
    setTracks(next);
    if (!player.current) return;
    if (next.length === 0) stop();
    else playFrom(player.current.position(), next);
  };
  const chooseTempo = (percent: number) => {
    setTempo(percent);
    if (player.current) playFrom(player.current.position(), tracks, percent);
  };
  const chooseTrim = (first: number, last: number) => {
    stop();
    setTrim([first, last]);
  };
  const seek = (time: number) => {
    const inside = Math.min(Math.max(time, trimStart), trimEnd - 0.001);
    setCursor(inside);
    if (player.current) playFrom(inside);
  };

  const save = async () => {
    stop();
    try {
      await store.putSong({
        ...loaded.song,
        title: title.trim() || loaded.song.title,
        settings: { tracks, tempoRate: tempo / 100, firstMeasure: trim[0], lastMeasure: trim[1] },
      });
      router.push(`/song?id=${id}`);
    } catch {
      setError('These settings could not be saved. Storage may be full or blocked.');
    }
  };

  const measureInput = (label: string, index: 0 | 1) => (
    <label className="flex items-center gap-2 text-sm">
      <span className="w-10 text-haze">{label}</span>
      <input
        type="number"
        className="w-20 rounded-block border-2 border-rule bg-night px-2 py-1 text-snow"
        min={index === 0 ? 1 : trim[0] + 1}
        max={index === 0 ? trim[1] + 1 : model.measures.length}
        value={trim[index] + 1}
        onChange={(e) => {
          const m = Math.round(Number(e.target.value)) - 1;
          if (!(m >= 0 && m < model.measures.length)) return;
          if (index === 0) chooseTrim(Math.min(m, trim[1]), trim[1]);
          else chooseTrim(trim[0], Math.max(m, trim[0]));
        }}
      />
      <span className="text-haze">{clock(index === 0 ? trimStart : trimEnd)}</span>
    </label>
  );

  const fit = measureSpan(model, tracks);
  const rate = tempo / 100;

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">Set up this piece</p>
        <input
          aria-label="Title"
          className="title mt-2 w-full border-b-2 border-rule bg-transparent pb-1 text-4xl focus:border-gold focus:outline-none sm:text-5xl"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>

      {error && <p className="card border-ember text-sm text-ember">{error}</p>}

      <section className="card space-y-4">
        <div>
          <h2 className="title text-2xl">Your part</h2>
          <p className="mt-2 text-sm text-haze">
            Tick the parts you will play. They are shown and played below, so you can check you have the right ones.
          </p>
        </div>
        <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
          {model.tracks.map((track) => {
            const range = ranges.get(track.index);
            const only = tracks.length === 1 && tracks[0] === track.index;
            return (
              <li key={track.index} className="flex items-center gap-2 text-sm">
                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 py-1">
                  <input
                    type="checkbox"
                    checked={tracks.includes(track.index)}
                    onChange={(e) =>
                      chooseTracks(e.target.checked ? [...tracks, track.index] : tracks.filter((t) => t !== track.index))
                    }
                  />
                  <span className="h-3 w-3 shrink-0" style={{ background: colors.get(track.index) }} />
                  <span className="truncate">{track.name}</span>
                  <span className="shrink-0 text-haze">
                    {track.noteCount} notes
                    {track.percussion ? ' · drums' : range ? ` · ${pitchName(range[0])}–${pitchName(range[1])}` : ''}
                  </span>
                </label>
                <button
                  type="button"
                  className="cursor-pointer text-xs tracking-wider text-haze uppercase hover:text-gold disabled:invisible"
                  disabled={only}
                  onClick={() => chooseTracks([track.index])}
                >
                  Only this
                </button>
              </li>
            );
          })}
        </ul>

        <TrackPreview
          song={model}
          tracks={tracks}
          colors={colors}
          first={trim[0]}
          last={trim[1]}
          onTrim={chooseTrim}
          position={position}
          onSeek={seek}
        />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <button
            type="button"
            className="btn btn-primary w-24"
            disabled={tracks.length === 0}
            onClick={() => (playing ? stop() : playFrom(startTime))}
          >
            {playing ? 'Stop' : 'Listen'}
          </button>
          <p className="text-sm">
            <span ref={clockRef} className="font-semibold" /> <span className="text-haze">of {clock(trimEnd)}</span>
          </p>
          <p className="text-sm text-haze">Click the roll to listen from there. Drag the white edges to trim.</p>
        </div>
      </section>

      <section className="card grid gap-6 sm:grid-cols-2">
        <label className="block space-y-2">
          <span className="eyebrow">Tempo</span>
          <span className="block font-display text-2xl">
            {Math.round(model.bpm * rate)} bpm <span className="font-body text-base text-haze">{tempo}% of the file</span>
          </span>
          <input
            type="range"
            className="w-full"
            min={MIN_TEMPO_RATE * 100}
            max={MAX_TEMPO_RATE * 100}
            step={1}
            value={tempo}
            onChange={(e) => chooseTempo(Number(e.target.value))}
          />
          <span className="block text-xs text-haze">
            The piece opens at this tempo. You can still change it for a single practice run.
          </span>
        </label>

        <div className="space-y-2">
          <p className="eyebrow">Trim</p>
          <p className="font-display text-2xl">
            {trim[1] - trim[0] + 1} measures{' '}
            <span className="font-body text-base text-haze">{clock((trimEnd - trimStart) / rate)} at this tempo</span>
          </p>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {measureInput('From', 0)}
            {measureInput('To', 1)}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs tracking-wider uppercase">
            <button
              type="button"
              className="cursor-pointer text-haze hover:text-gold disabled:hidden"
              disabled={tracks.length === 0 || (fit[0] === trim[0] && fit[1] === trim[1])}
              onClick={() => chooseTrim(fit[0], fit[1])}
            >
              Fit to your part
            </button>
            <button
              type="button"
              className="cursor-pointer text-haze hover:text-gold disabled:hidden"
              disabled={trim[0] === 0 && trim[1] === model.measures.length - 1}
              onClick={() => chooseTrim(0, model.measures.length - 1)}
            >
              Keep everything
            </button>
          </div>
        </div>
      </section>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          className="btn btn-primary px-8 py-3 text-base"
          disabled={tracks.length === 0}
          onClick={() => void save()}
        >
          Save and practice
        </button>
        <Link href={loaded.song.settings ? `/song?id=${id}` : '/'} className="btn">
          {loaded.song.settings ? 'Cancel' : 'Set up later'}
        </Link>
      </div>
    </div>
  );
}
