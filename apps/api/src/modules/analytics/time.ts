import { ApiError } from '../../http/api-error.js';

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export function parseCalendarDate(value: unknown, field: string): string {
  if (typeof value !== 'string' || !datePattern.test(value)) {
    throw new ApiError(
      400,
      'invalid_analytics_date',
      `${field} must use YYYY-MM-DD.`,
    );
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new ApiError(
      400,
      'invalid_analytics_date',
      `${field} is not a valid date.`,
    );
  }
  return value;
}

export function localDateAt(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.map(({ type, value }) => [type, value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

export function localMidnightUtc(date: string, timezone: string): Date {
  const [yearText, monthText, dayText] = date.split('-');
  const target = Date.UTC(
    Number(yearText),
    Number(monthText) - 1,
    Number(dayText),
  );
  let guess = target;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const formatted = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(guess));
    const values = Object.fromEntries(
      formatted.map(({ type, value }) => [type, value]),
    );
    const represented = Date.UTC(
      Number(values.year),
      Number(values.month) - 1,
      Number(values.day),
      Number(values.hour),
      Number(values.minute),
      Number(values.second),
    );
    const difference = target - represented;
    guess += difference;
    if (difference === 0) {
      break;
    }
  }

  return new Date(guess);
}

export function dateBucket(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

export function addCalendarDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function dateLabelsBetween(
  start: Date,
  end: Date,
  timezone: string,
): string[] {
  if (end <= start) {
    return [];
  }
  const first = localDateAt(start, timezone);
  const last = localDateAt(new Date(end.getTime() - 1), timezone);
  const dates: string[] = [];
  for (let date = first; date <= last; date = addCalendarDays(date, 1)) {
    dates.push(date);
  }
  return dates;
}

export function validateTimezone(timezone: string): string {
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone });
    return timezone;
  } catch {
    throw new ApiError(
      500,
      'invalid_guild_timezone',
      'The server timezone configuration is invalid.',
    );
  }
}
