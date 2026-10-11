'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { parseMidi } from './lib/midi/parse';
import { buildSongModel } from './lib/midi/songModel';
import { store } from './lib/store';
import { drills } from './lib/drills/registry';
import { exportBackup, importBackup } from './lib/store/backup';
import { getCurrentUserId } from './lib/prefs';
import { reloadUsers } from './lib/users';
import type { DrillPreset, SongSummary } from './types';

const errorText = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong');

export default function LibraryPage() {
  const router = useRouter();
  const [songs, setSongs] = useState<SongSummary[] | null>(null);
  const [saved, setSaved] = useState<DrillPreset[]>([]);
  const [error, setError] = useState<string | null>(null);
  const midiInput = useRef<HTMLInputElement>(null);
  const backupInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      setSongs(await store.listSongs());
      setSaved((await Promise.all(drills.map((d) => store.listPresets(d.id)))).flat());
    } catch (e) {
      setError(errorText(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const addSongs = async (files: File[]) => {
    setError(null);
    const added: string[] = [];
    for (const file of files) {
      try {
        const midi = await file.arrayBuffer();
        buildSongModel(parseMidi(midi)); // reject unreadable files before storing them
        const id = crypto.randomUUID();
        await store.putSong({
          id,
          title: file.name.replace(/\.(mid|midi)$/i, ''),
          midi,
          addedAt: Date.now(),
        });
        added.push(id);
      } catch (e) {
        setError(`${file.name}: ${errorText(e)}`);
      }
    }
    // One new piece goes straight to its setup; several wait in the library.
    if (added.length === 1 && files.length === 1) router.push(`/song/setup?id=${added[0]}`);
    else await refresh();
  };

  const removeSong = async (song: SongSummary) => {
    if (!confirm(`Delete “${song.title}” and every player's practice history of it?`)) return;
    await store.deleteSong(song.id);
    await refresh();
  };

  const downloadBackup = async () => {
    const url = URL.createObjectURL(new Blob([await exportBackup(store)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `piano-practice-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const restoreBackup = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      // An old backup has no players; its history goes to whoever is playing now.
      const userId = getCurrentUserId();
      if (!userId) throw new Error('Choose a player first');
      await importBackup(store, await file.text(), userId);
    } catch (e) {
      setError(errorText(e));
    }
    await Promise.all([refresh(), reloadUsers()]);
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Library</p>
          <h1 className="title text-4xl sm:text-5xl">Your pieces</h1>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => midiInput.current?.click()}>
          Add MIDI file
        </button>
        <input
          ref={midiInput}
          type="file"
          accept=".mid,.midi,audio/midi"
          multiple
          hidden
          onChange={(e) => {
            // Copy the list: clearing the input below empties the live FileList.
            void addSongs([...(e.target.files ?? [])]);
            e.target.value = '';
          }}
        />
      </div>

      {error && <p className="card border-ember text-sm text-ember">{error}</p>}

      {songs && songs.length === 0 && (
        <p className="card text-haze">Nothing here yet. Add a MIDI file of a piece you want to learn.</p>
      )}

      <ul className="space-y-3">
        {songs?.map((song) => (
          <li key={song.id} className="card flex items-center justify-between gap-4">
            <Link href={`/song?id=${song.id}`} className="min-w-0 flex-1 hover:text-gold">
              <span className="block truncate font-display text-xl uppercase">{song.title}</span>
              <span className="text-sm text-haze">Added {new Date(song.addedAt).toLocaleDateString()}</span>
            </Link>
            <Link href={`/song/setup?id=${song.id}`} className="btn">
              Set up
            </Link>
            <button type="button" className="btn" onClick={() => void removeSong(song)}>
              Delete
            </button>
          </li>
        ))}
      </ul>

      <section className="space-y-3">
        <h2 className="title text-3xl">Drills</h2>
        <ul className="space-y-3">
          {drills.map((drill) => (
            <li key={drill.id} className="card space-y-3">
              <Link href={`/drill?id=${drill.id}`} className="block hover:text-gold">
                <span className="block font-display text-xl uppercase">{drill.name}</span>
                <span className="text-sm text-haze">{drill.description}</span>
              </Link>
              <div className="flex flex-wrap gap-2">
                {[...drill.presets, ...saved.filter((p) => p.drillId === drill.id)].map((preset) => (
                  <Link key={preset.id} href={`/drill?id=${drill.id}&preset=${preset.id}`} className="btn">
                    {preset.name}
                  </Link>
                ))}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3 border-t border-rule pt-6">
        <p className="text-sm text-haze">
          Pieces, players, saved drill settings and practice history are stored in this browser. Clearing site data erases them, so keep a backup.
        </p>
        <div className="flex flex-wrap gap-3">
          <button type="button" className="btn" onClick={() => void downloadBackup()}>
            Download backup
          </button>
          <button type="button" className="btn" onClick={() => backupInput.current?.click()}>
            Restore backup
          </button>
          <input
            ref={backupInput}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              void restoreBackup(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </div>
      </section>
    </div>
  );
}
