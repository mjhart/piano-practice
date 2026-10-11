import type { DrillConfig, Exercise } from '../../types';

export type Option = { value: string; label: string };

/** One setting on a drill's settings form. The form is drawn from these; drills have no UI code. */
export type Field<C extends DrillConfig> =
  | { kind: 'choice'; key: keyof C & string; label: string; options: Option[] }
  /** Pick at least one. The order they were picked in is kept. */
  | { kind: 'multi'; key: keyof C & string; label: string; options: Option[] }
  | { kind: 'number'; key: keyof C & string; label: string; min: number; max: number; step?: number }
  | { kind: 'toggle'; key: keyof C & string; label: string }
  | { kind: 'text'; key: keyof C & string; label: string; hint?: string };

/** A source of random numbers in [0, 1). Drills get one seeded, so an exercise can be made again. */
export type Rng = () => number;

/**
 * A drill. To add one, write a file exporting a DrillDefinition and add it to
 * the list in ./registry.ts; storage, scoring and screens need no changes.
 */
export type DrillDefinition<C extends DrillConfig> = {
  /** Stored on runs, so it never changes. */
  id: string;
  name: string;
  description: string;
  /**
   * Bump when the same settings and seed would generate different notes. Old
   * runs still score from their stored exercise either way.
   */
  version: number;
  fields: Field<C>[];
  defaults: C;
  /** Built in, shown before any saved presets. `id` is stored on runs, so it never changes. */
  presets: { id: string; name: string; config: C }[];
  /** Whether these settings use randomness, so "New random" means something. */
  random?(config: C): boolean;
  /**
   * Only called with settings that passed `resolveConfig`. Pure: the same
   * settings and seed always give the same exercise. Write the notes at
   * REFERENCE_BPM (see ./exercise.ts); the tempo control only changes the rate.
   */
  generate(config: C, rng: Rng): Exercise;
  /** One line for history, e.g. "ii-V-I-I · 5 keys · triads". */
  summary(config: C): string;
};
