import type { DrillConfig } from '../../types';
import { chordProgressions } from './chordProgressions.ts';
import type { DrillDefinition } from './types';

/**
 * Forgets a drill's own settings type so drills can share one list. Safe
 * because settings only reach a drill through resolveConfig, which builds
 * them from that drill's own fields and defaults.
 */
const register = <C extends DrillConfig>(drill: DrillDefinition<C>) => drill as unknown as DrillDefinition<DrillConfig>;

/** Every drill, in the order the library lists them. Add new drills here. */
export const drills: DrillDefinition<DrillConfig>[] = [register(chordProgressions)];

export const findDrill = (id: string) => drills.find((d) => d.id === id);
