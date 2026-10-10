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
