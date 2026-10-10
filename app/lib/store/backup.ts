import type { Run, Song } from '../../types';
import type { PracticeStore } from './store';

// Backup and restore work through the PracticeStore interface, so the same
// code can move data between stores (for example browser to backend).

type Backup = {
  version: 1;
  songs: (Omit<Song, 'midi'> & { midi: string })[];
  runs: Run[];
};

function toBase64(buffer: ArrayBuffer): string {
  let binary = '';
  for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(text: string): ArrayBuffer {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export async function exportBackup(store: PracticeStore): Promise<string> {
  const backup: Backup = { version: 1, songs: [], runs: [] };
  for (const { id } of await store.listSongs()) {
    const song = await store.getSong(id);
    if (!song) continue;
    backup.songs.push({ ...song, midi: toBase64(song.midi) });
    backup.runs.push(...(await store.listRuns(id)));
  }
  return JSON.stringify(backup);
}

/** Adds everything in the backup, replacing records that share an id. */
export async function importBackup(store: PracticeStore, json: string): Promise<void> {
  const backup = JSON.parse(json) as Backup;
  if (backup.version !== 1 || !Array.isArray(backup.songs) || !Array.isArray(backup.runs)) {
    throw new Error('Not a piano practice backup file');
  }
  for (const song of backup.songs) await store.putSong({ ...song, midi: fromBase64(song.midi) });
  for (const run of backup.runs) await store.putRun(run);
}
