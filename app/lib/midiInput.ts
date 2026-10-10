'use client';

import { useSyncExternalStore } from 'react';

// One shared connection to the Web MIDI API. It listens to every connected
// input, so plugging a keyboard in is all the user has to do.

export type NoteEvent = {
  pitch: number;
  velocity: number;
  on: boolean;
  /** Same timebase as performance.now(). */
  timeStamp: number;
};

export type MidiStatus = {
  state: 'idle' | 'pending' | 'ready' | 'denied' | 'unsupported';
  inputs: string[];
};

const IDLE: MidiStatus = { state: 'idle', inputs: [] };
let status = IDLE;
const statusListeners = new Set<() => void>();
const noteListeners = new Set<(e: NoteEvent) => void>();

function setStatus(next: MidiStatus) {
  status = next;
  statusListeners.forEach((listener) => listener());
}

function onMessage(e: MIDIMessageEvent) {
  const data = e.data;
  if (!data || data.length < 3) return;
  const kind = data[0] & 0xf0;
  if (kind !== 0x90 && kind !== 0x80) return;
  // Not every browser and driver stamps MIDI events on the performance.now()
  // clock. Trust the event's own time only when it is a plausible recent
  // moment on that clock; otherwise use the time the event arrived.
  const now = performance.now();
  const plausible = e.timeStamp > now - 100 && e.timeStamp <= now + 5;
  const event: NoteEvent = {
    pitch: data[1],
    velocity: data[2],
    // A note-on with velocity 0 is how many keyboards send note-off.
    on: kind === 0x90 && data[2] > 0,
    timeStamp: plausible ? e.timeStamp : now,
  };
  noteListeners.forEach((listener) => listener(event));
}

function attach(access: MIDIAccess) {
  const inputs: string[] = [];
  access.inputs.forEach((input) => {
    input.onmidimessage = onMessage;
    if (input.state === 'connected') inputs.push(input.name || 'MIDI device');
  });
  setStatus({ state: 'ready', inputs });
}

export async function connectMidi(): Promise<void> {
  if (status.state === 'pending' || status.state === 'ready') return;
  if (typeof navigator === 'undefined' || !navigator.requestMIDIAccess) {
    setStatus({ state: 'unsupported', inputs: [] });
    return;
  }
  setStatus({ state: 'pending', inputs: [] });
  try {
    const access = await navigator.requestMIDIAccess();
    access.onstatechange = () => attach(access);
    attach(access);
  } catch {
    setStatus({ state: 'denied', inputs: [] });
  }
}

export function subscribeNotes(listener: (e: NoteEvent) => void): () => void {
  noteListeners.add(listener);
  return () => noteListeners.delete(listener);
}

function subscribeStatus(listener: () => void): () => void {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

export function useMidiStatus(): MidiStatus {
  return useSyncExternalStore(
    subscribeStatus,
    () => status,
    () => IDLE,
  );
}
