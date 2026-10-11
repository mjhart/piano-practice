import type { DrillPreset, Song, User } from '../../types';
import { drills } from '../drills/registry';
import { upgradeRun, type StoredRun } from '../sources';
import type { PracticeStore } from './store';

// Backup and restore work through the PracticeStore interface, so the same
// code can move data between stores (for example browser to backend).

// Version 1 came before users: it has no users and its runs no userId.
// Versions 1 and 2 came before drills: no presets, and runs name a songId.
type Backup = {
  version: 1 | 2 | 3;
  songs: (Omit<Song, 'midi'> & { midi: string })[];
  users?: User[];
  presets?: DrillPreset[];
  runs: (Omit<StoredRun, 'userId'> & { userId?: string })[];
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
  const users = await store.listUsers();
  const backup: Backup = { version: 3, songs: [], users, presets: [], runs: [] };
  for (const { id } of await store.listSongs()) {
    const song = await store.getSong(id);
    if (song) backup.songs.push({ ...song, midi: toBase64(song.midi) });
  }
  for (const drill of drills) backup.presets!.push(...(await store.listPresets(drill.id)));
  for (const user of users) backup.runs.push(...(await store.listUserRuns(user.id)));
  return JSON.stringify(backup);
}

/**
 * Adds everything in the backup, replacing records that share an id. Runs
 * that name no user (from a backup made before there were users) go to `userId`.
 */
export async function importBackup(store: PracticeStore, json: string, userId: string): Promise<void> {
  const backup = JSON.parse(json) as Backup;
  if (![1, 2, 3].includes(backup.version) || !Array.isArray(backup.songs) || !Array.isArray(backup.runs)) {
    throw new Error('Not a piano practice backup file');
  }
  for (const song of backup.songs) await store.putSong({ ...song, midi: fromBase64(song.midi) });
  for (const user of backup.users ?? []) await store.putUser(user);
  for (const preset of backup.presets ?? []) await store.putPreset(preset);
  for (const run of backup.runs) await store.putRun(upgradeRun({ ...run, userId: run.userId ?? userId }));
}
