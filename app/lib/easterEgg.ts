import type { Run, User } from '../types';

// An Easter egg: a shower of kisses when a player whose name contains "wife"
// finishes a run, so a run that reached the end of its section.

export function isWife(name: string): boolean {
  return name.toLowerCase().includes('wife');
}

/** Whether any of `runs` is a finished one by a player in `users` named like a wife. */
export function earnsKiss(runs: Run[], users: User[]): boolean {
  return runs.some((run) => run.completed && isWife(users.find((u) => u.id === run.userId)?.name ?? ''));
}
