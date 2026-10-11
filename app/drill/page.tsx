'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { resolveConfig, sameConfig } from '../lib/drills/fields';
import { newSeed, seededRng } from '../lib/drills/random';
import { findDrill } from '../lib/drills/registry';
import type { DrillDefinition } from '../lib/drills/types';
import { store } from '../lib/store';
import type { DrillConfig, DrillPreset, Run, RunSource } from '../types';
import { PracticeSession } from '../song/components/PracticeSession';
import { DrillForm } from './DrillForm';

/** The tempo a drill opens at. */
const START_BPM = 80;

export default function DrillPage() {
  return (
    <Suspense>
      <DrillLoader />
    </Suspense>
  );
}

function DrillLoader() {
  const params = useSearchParams();
  const drill = findDrill(params.get('id') ?? '');
  if (!drill) {
    return (
      <div className="space-y-4">
        <p className="card border-ember text-ember">There is no such drill.</p>
        <Link href="/" className="btn">
          Back to the library
        </Link>
      </div>
    );
  }
  return <DrillView key={drill.id} drill={drill} presetParam={params.get('preset')} />;
}

type Setup = { config: DrillConfig; seed: number; presetId?: string };

function DrillView({ drill, presetParam }: { drill: DrillDefinition<DrillConfig>; presetParam: string | null }) {
  const [saved, setSaved] = useState<DrillPreset[] | null>(null);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reloadPresets = useCallback(
    () =>
      store.listPresets(drill.id).then(
        (list) => {
          setSaved(list);
          return list;
        },
        () => {
          setError('Saved settings could not be loaded.');
          setSaved([]);
          return [];
        },
      ),
    [drill.id],
  );

  // Open on the preset in the link, else the drill's first one.
  useEffect(() => {
    void reloadPresets().then((list) => {
      const preset = [...drill.presets, ...list].find((p) => p.id === presetParam) ?? drill.presets[0];
      setSetup({
        config: resolveConfig(drill, preset?.config ?? drill.defaults),
        seed: newSeed(),
        presetId: preset?.id,
      });
    });
  }, [drill, presetParam, reloadPresets]);

  const exercise = useMemo(() => setup && drill.generate(setup.config, seededRng(setup.seed)), [drill, setup]);
  const source = useMemo<RunSource | null>(
    () =>
      setup &&
      exercise && {
        kind: 'drill',
        drillId: drill.id,
        drillVersion: drill.version,
        ...(setup.presetId && { presetId: setup.presetId }),
        config: setup.config,
        seed: setup.seed,
        exercise,
      },
    [drill, setup, exercise],
  );

  // A drill's runs are scored against the exercise each one played.
  const modelOf = useCallback((run: Run) => (run.source.kind === 'drill' ? run.source.exercise : exercise!), [exercise]);
  const sameExercise = useCallback(
    (run: Run) =>
      !!setup &&
      run.source.kind === 'drill' &&
      run.source.drillVersion === drill.version &&
      sameConfig(run.source.config, setup.config) &&
      (run.source.seed === setup.seed || !drill.random?.(setup.config)),
    [drill, setup],
  );
  const onRestore = useCallback(
    (run: Run) => {
      if (run.source.kind !== 'drill') return;
      setSetup({ config: resolveConfig(drill, run.source.config), seed: run.source.seed, presetId: run.source.presetId });
    },
    [drill],
  );
  const describe = useCallback((run: Run) => (run.source.kind === 'drill' ? drill.summary(resolveConfig(drill, run.source.config)) : ''), [drill]);

  if (!setup || !exercise || !source || !saved) return <p className="text-haze">Loading…</p>;

  const presets = [...drill.presets.map((p) => ({ ...p, saved: false })), ...saved.map((p) => ({ ...p, saved: true }))];
  const current = presets.find((p) => p.id === setup.presetId);
  const edited = current && !sameConfig(resolveConfig(drill, current.config), setup.config);

  const change = (key: string, value: unknown) =>
    setSetup({ ...setup, config: resolveConfig(drill, { ...setup.config, [key]: value }) });

  const save = async () => {
    const name = prompt('Name these settings', current && edited ? `${current.name} (mine)` : drill.summary(setup.config));
    if (!name?.trim()) return;
    const preset: DrillPreset = { id: crypto.randomUUID(), drillId: drill.id, name: name.trim(), config: setup.config, addedAt: Date.now() };
    try {
      await store.putPreset(preset);
      await reloadPresets();
      setSetup({ ...setup, presetId: preset.id });
    } catch {
      setError('These settings could not be saved.');
    }
  };

  const remove = async (preset: { id: string; name: string }) => {
    if (!confirm(`Delete the saved settings “${preset.name}” for every player? Practice history stays.`)) return;
    await store.deletePreset(preset.id);
    await reloadPresets();
  };

  return (
    <PracticeSession
      heading={
        <div>
          <p className="eyebrow">
            Drill · {exercise.measures.length} measures{current ? ` · ${current.name}${edited ? ' (changed)' : ''}` : ''}
          </p>
          <h1 className="title mt-2 text-4xl sm:text-5xl">{drill.name}</h1>
          <p className="mt-2 text-sm text-haze">{drill.description}</p>
        </div>
      }
      model={exercise}
      source={source}
      trim={[0, exercise.measures.length - 1]}
      initialTracks={exercise.tracks.map((t) => t.index)}
      initialTempoRate={START_BPM / exercise.bpm}
      tempo={{
        min: 30 / exercise.bpm,
        max: 180 / exercise.bpm,
        step: 1 / exercise.bpm,
        label: (rate) => `${Math.round(rate * exercise.bpm)} bpm`,
      }}
      modelOf={modelOf}
      sameExercise={sameExercise}
      onRestore={onRestore}
      describe={describe}
      wholeLabel="Whole drill"
      backLabel="Back to the drill"
    >
      {error && <p className="card border-ember text-sm text-ember">{error}</p>}
      <section className="card space-y-3">
        <h2 className="eyebrow">Presets</h2>
        <div className="flex flex-wrap gap-2">
          {presets.map((preset) => (
            <span key={preset.id} className="inline-flex">
              <button
                type="button"
                className={`btn ${preset.id === setup.presetId ? 'btn-primary' : ''}`}
                aria-pressed={preset.id === setup.presetId}
                onClick={() => setSetup({ config: resolveConfig(drill, preset.config), seed: newSeed(), presetId: preset.id })}
              >
                {preset.name}
              </button>
              {preset.saved && (
                <button type="button" className="btn ml-1" aria-label={`Delete ${preset.name}`} onClick={() => void remove(preset)}>
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
      </section>

      <section className="card space-y-5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="title text-2xl">Settings</h2>
          <div className="flex flex-wrap gap-2">
            {drill.random?.(setup.config) && (
              <button type="button" className="btn" onClick={() => setSetup({ ...setup, seed: newSeed() })}>
                New random version
              </button>
            )}
            <button type="button" className="btn" onClick={() => void save()}>
              Save these settings
            </button>
          </div>
        </div>
        <p className="text-sm text-haze">{drill.summary(setup.config)}</p>
        <DrillForm fields={drill.fields} config={setup.config} onChange={change} />
      </section>
    </PracticeSession>
  );
}
