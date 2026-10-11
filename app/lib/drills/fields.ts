import type { DrillConfig } from '../../types';
import type { DrillDefinition } from './types';

const clamp = (value: number, lo: number, hi: number) => Math.min(Math.max(value, lo), hi);

/**
 * Settings made safe to generate from: anything missing, of the wrong kind or
 * no longer offered falls back to the drill's default. Used on stored presets,
 * links and every edit on the settings form.
 */
export function resolveConfig<C extends DrillConfig>(drill: DrillDefinition<C>, raw: unknown): C {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const config: DrillConfig = { ...drill.defaults };
  for (const field of drill.fields) {
    const value = input[field.key];
    const fallback = drill.defaults[field.key];
    if (field.kind === 'choice') {
      config[field.key] = field.options.some((o) => o.value === value) ? (value as string) : fallback;
    } else if (field.kind === 'multi') {
      // Kept in the order picked, which some drills play in.
      const offered = new Set(field.options.map((o) => o.value));
      const kept = [...new Set(Array.isArray(value) ? value : [])].filter((v) => offered.has(v)) as string[];
      config[field.key] = kept.length ? kept : fallback;
    } else if (field.kind === 'number') {
      const step = field.step ?? 1;
      config[field.key] =
        typeof value === 'number' && Number.isFinite(value)
          ? clamp(field.min + Math.round((value - field.min) / step) * step, field.min, field.max)
          : fallback;
    } else if (field.kind === 'toggle') {
      config[field.key] = typeof value === 'boolean' ? value : fallback;
    } else {
      config[field.key] = typeof value === 'string' ? value.slice(0, 200) : fallback;
    }
  }
  return config as C;
}

/** Whether two resolved settings are the same, field by field. */
export function sameConfig(a: DrillConfig, b: DrillConfig): boolean {
  return JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());
}
