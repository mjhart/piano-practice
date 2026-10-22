/** "45 s", "25 min" or "3 h 10 min". */
export function duration(ms: number): string {
  if (ms < 60000) return `${Math.round(ms / 1000)} s`;
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ''}`;
}

/** A date such as "3 Oct", with the year only when it isn't this one. */
export function shortDate(ms: number): string {
  const date = new Date(ms);
  const thisYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString([], { day: 'numeric', month: 'short', ...(!thisYear && { year: 'numeric' }) });
}
