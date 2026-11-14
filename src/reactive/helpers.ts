/** "5 minutes ago" style text. `value` is an ISO string, a timestamp in ms or a Date. */
export function relativeTime(value: unknown, nowMs: number, locale?: string): string {
  const t =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Date.parse(value)
        : value instanceof Date
          ? value.getTime()
          : NaN;
  if (!Number.isFinite(t)) return '';

  const diff = Math.round((t - nowMs) / 1000); // negative = past
  const abs = Math.abs(diff);
  let unit: Intl.RelativeTimeFormatUnit = 'day';
  let div = 86400;
  if (abs < 60) {
    unit = 'second';
    div = 1;
  } else if (abs < 3600) {
    unit = 'minute';
    div = 60;
  } else if (abs < 86400) {
    unit = 'hour';
    div = 3600;
  }

  let rtf: Intl.RelativeTimeFormat;
  try {
    rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  } catch {
    rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  }
  return rtf.format(Math.trunc(diff / div), unit);
}
