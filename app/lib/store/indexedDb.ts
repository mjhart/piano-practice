import type { Run, Song, SongSummary } from '../../types';
import type { PracticeStore } from './store';

const DB_NAME = 'piano-practice';
const DB_VERSION = 1;

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
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore('songs', { keyPath: 'id' });
        db.createObjectStore('runs', { keyPath: 'id' }).createIndex('songId', 'songId');
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

  async putRun(run: Run): Promise<void> {
    const tx = (await this.open()).transaction('runs', 'readwrite');
    tx.objectStore('runs').put(run);
    await done(tx);
  }

  async listRuns(songId: string): Promise<Run[]> {
    const tx = (await this.open()).transaction('runs');
    const runs: Run[] = await result(tx.objectStore('runs').index('songId').getAll(songId));
    return runs.sort((a, b) => a.startedAt - b.startedAt);
  }
}
