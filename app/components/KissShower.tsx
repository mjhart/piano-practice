'use client';

import { useEffect, useMemo, type CSSProperties } from 'react';

const COUNT = 18;
const DURATION_MS = 3200;

/** Kisses float up the screen, then `onDone` is called. It never takes clicks or focus. */
export function KissShower({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDone, DURATION_MS);
    return () => clearTimeout(timer);
  }, [onDone]);

  const kisses = useMemo(
    () =>
      Array.from({ length: COUNT }, (_, i) => ({
        left: `${5 + Math.random() * 90}%`,
        size: `${2 + Math.random() * 2.5}rem`,
        delay: `${i === 0 ? 0 : Math.random() * 1200}ms`,
        drift: `${(Math.random() - 0.5) * 8}rem`,
        tilt: `${(Math.random() - 0.5) * 50}deg`,
      })),
    [],
  );

  return (
    <div className="pointer-events-none fixed inset-0 z-50 overflow-hidden" aria-hidden="true">
      <span className="kiss-big">💋</span>
      {kisses.map((k, i) => (
        <span
          key={i}
          className="kiss-float"
          style={
            {
              left: k.left,
              fontSize: k.size,
              animationDelay: k.delay,
              '--drift': k.drift,
              '--tilt': k.tilt,
            } as CSSProperties
          }
        >
          💋
        </span>
      ))}
    </div>
  );
}
