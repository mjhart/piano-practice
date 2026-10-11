// Per-device settings. These describe this computer's audio setup, not the
// user's practice history, so they live outside the PracticeStore.

const LATENCY_KEY = 'metronomeOffsetMs';

export function getMetronomeOffset(): number {
  try {
    return Number(localStorage.getItem(LATENCY_KEY)) || 0;
  } catch {
    return 0;
  }
}

export function setMetronomeOffset(ms: number) {
  try {
    localStorage.setItem(LATENCY_KEY, String(ms));
  } catch {
    // Storage can be blocked; the setting then lasts only for this page.
  }
}

// Which user is practising on this device. The users themselves are practice
// data and live in the PracticeStore; only the choice is kept here.
const USER_KEY = 'currentUserId';

export function getCurrentUserId(): string | null {
  try {
    return localStorage.getItem(USER_KEY);
  } catch {
    return null;
  }
}

export function setCurrentUserId(id: string) {
  try {
    localStorage.setItem(USER_KEY, id);
  } catch {
    // As above: the choice then lasts only for this page.
  }
}
