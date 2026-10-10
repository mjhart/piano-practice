'use client';

import { useEffect } from 'react';
import { connectMidi, useMidiStatus } from '../lib/midiInput';

export function MidiStatus() {
  const status = useMidiStatus();

  useEffect(() => {
    void connectMidi();
  }, []);

  if (status.state === 'unsupported') {
    return <p className="text-sm text-ember">This browser has no MIDI support. Use Chrome, Edge or Firefox.</p>;
  }
  if (status.state === 'denied') {
    return (
      <button type="button" className="btn" onClick={() => void connectMidi()}>
        Allow MIDI access
      </button>
    );
  }
  if (status.state !== 'ready') return <p className="text-sm text-haze">Looking for a keyboard…</p>;

  const connected = status.inputs.length > 0;
  return (
    <p className="flex items-center gap-2 text-sm">
      <span className={`h-2.5 w-2.5 ${connected ? 'bg-gold' : 'bg-rule'}`} />
      <span className={connected ? 'text-snow' : 'text-haze'}>
        {connected ? status.inputs.join(', ') : 'No keyboard connected. Plug one in.'}
      </span>
    </p>
  );
}
