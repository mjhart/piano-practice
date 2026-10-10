import { IndexedDbStore } from './indexedDb';
import type { PracticeStore } from './store';

// The one place that chooses a storage implementation.
export const store: PracticeStore = new IndexedDbStore();
