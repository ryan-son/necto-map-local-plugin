//
// Copyright (c) 2026 necto-map-local-plugin contributors
//

/// Necto reports durations in fractional milliseconds; this fits them in a 6ch column.
export function formatDuration(ms: number): string {
  if (ms < 1) return "<1ms";
  const whole = Math.round(ms);
  return whole < 1000 ? `${whole}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/// A start time as HH:MM:SS.mmm in local time. Fixed rather than localised, as in Necto's
/// Network panel: a locale renders "12:46:21 PM", or hours and minutes as words, wider than the
/// column and harder to compare down a list.
export function formatClock(ms: number): string {
  const date = new Date(ms);
  const pad = (value: number, width = 2) => String(value).padStart(width, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}
