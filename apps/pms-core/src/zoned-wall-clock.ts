/** UTC instant for local `HH:MM` on `dateStr` (YYYY-MM-DD) in `timeZone`. Two-pass fixed point + gap/overlap policy. */
export function zonedWallClockMs(dateStr: string, timeZone: string, hh: number, mm: number): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) throw new Error(`invalid date: ${dateStr}`);
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);

  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });

  const asUtcFromZoned = (instant: number): number => {
    const parts = dtf.formatToParts(new Date(instant));
    const get = (type: Intl.DateTimeFormatPartTypes): number =>
      Number(parts.find((p) => p.type === type)?.value);
    return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  };

  const twoPass = (utcGuess: number): number => {
    const guess = utcGuess - (asUtcFromZoned(utcGuess) - utcGuess);
    return utcGuess - (asUtcFromZoned(guess) - guess);
  };

  let candidate = twoPass(Date.UTC(y, mo, d, hh, mm, 0));

  const readLocal = (instant: number) => {
    const parts = dtf.formatToParts(new Date(instant));
    const get = (type: Intl.DateTimeFormatPartTypes): number =>
      Number(parts.find((p) => p.type === type)?.value);
    return {
      year: get('year'),
      month: get('month'),
      day: get('day'),
      hour: get('hour'),
      minute: get('minute'),
    };
  };

  // Gap (spring forward): advance 1 minute until local matches requested on same calendar date
  for (let i = 0; i < 180; i++) {
    const local = readLocal(candidate);
    const sameDate =
      local.year === y && local.month === mo + 1 && local.day === d;
    if (sameDate && local.hour === hh && local.minute === mm) break;
    if (!sameDate) break;
    if (local.hour < hh || (local.hour === hh && local.minute < mm)) {
      candidate += 60_000;
      continue;
    }
    // Full-hour gap forward (e.g. 02:00 → 03:00): stop at next real local instant
    break;
  }

  return candidate;
}
