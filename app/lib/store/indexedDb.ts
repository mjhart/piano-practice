import type { Run, Song, SongSummary, User } from '../../types';
import { FIRST_USER_NAME, type PracticeStore } from './store';

const DB_NAME = 'piano-practice';
const DB_VERSION = 2;

function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export class IndexedDbStore implements PracticeStore {
  private db: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    if (!this.db) {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (e) => {
        const db = request.result;
        const tx = request.transaction!;
        if (e.oldVersion < 1) {
          db.createObjectStore('songs', { keyPath: 'id' });
          db.createObjectStore('runs', { keyPath: 'id' }).createIndex('songId', 'songId');
        }
        if (e.oldVersion < 2) {
          // Users arrive. Whoever practised before becomes the first user and
          // keeps every run already recorded.
          const user: User = { id: crypto.randomUUID(), name: FIRST_USER_NAME, addedAt: Date.now() };
          db.createObjectStore('users', { keyPath: 'id' }).put(user);
          const runs = tx.objectStore('runs');
          runs.createIndex('userId', 'userId');
          runs.createIndex('songUser', ['songId', 'userId']);
          runs.openCursor().onsuccess = (event) => {
            const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>).result;
            if (!cursor) return;
            cursor.update({ ...cursor.value, userId: user.id });
            cursor.continue();
          };
        }
      };
      this.db = result(request);
      // Ask the browser not to evict this data under storage pressure.
      void navigator.storage?.persist?.().catch(() => false);
    }
    return this.db;
  }

  async putSong(song: Song): Promise<void> {
    const tx = (await this.open()).transaction('songs', 'readwrite');
    tx.objectStore('songs').put(song);
    await done(tx);
  }

  async listSongs(): Promise<SongSummary[]> {
    const tx = (await this.open()).transaction('songs');
    const songs: Song[] = await result(tx.objectStore('songs').getAll());
    return songs
      .map(({ id, title, addedAt }) => ({ id, title, addedAt }))
      .sort((a, b) => b.addedAt - a.addedAt);
  }

  async getSong(id: string): Promise<Song | undefined> {
    const tx = (await this.open()).transaction('songs');
    return result(tx.objectStore('songs').get(id));
  }

  async deleteSong(id: string): Promise<void> {
    const tx = (await this.open()).transaction(['songs', 'runs'], 'readwrite');
    tx.objectStore('songs').delete(id);
    const runs = tx.objectStore('runs');
    for (const key of await result(runs.index('songId').getAllKeys(id))) runs.delete(key);
    await done(tx);
  }

  async putUser(user: User): Promise<void> {
    const tx = (await this.open()).transaction('users', 'readwrite');
    tx.objectStore('users').put(user);
    await done(tx);
  }

  async listUsers(): Promise<User[]> {
    const tx = (await this.open()).transaction('users');
    const users: User[] = await result(tx.objectStore('users').getAll());
    return users.sort((a, b) => a.addedAt - b.addedAt);
  }

  async deleteUser(id: string): Promise<void> {
    const tx = (await this.open()).transaction(['users', 'runs'], 'readwrite');
    tx.objectStore('users').delete(id);
    const runs = tx.objectStore('runs');
    for (const key of await result(runs.index('userId').getAllKeys(id))) runs.delete(key);
    await done(tx);
  }

  async putRun(run: Run): Promise<void> {
    const tx = (await this.open()).transaction('runs', 'readwrite');
    tx.objectStore('runs').put(run);
    await done(tx);
  }

  async listRuns(songId: string, userId: string): Promise<Run[]> {
    const tx = (await this.open()).transaction('runs');
    const runs: Run[] = await result(tx.objectStore('runs').index('songUser').getAll([songId, userId]));
    return runs.sort((a, b) => a.startedAt - b.startedAt);
  }
}
