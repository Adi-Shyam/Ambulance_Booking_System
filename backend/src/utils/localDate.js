'use strict';
// Reporting calendar helpers (F.13).
//
// The Data Dictionary stores every timestamp in UTC. Analytics, however, are
// read by a control room operating in one civil timezone: "bookings today" and
// "demand by hour" mean the local day and the local hour, not the UTC ones.
// Bucketing on the raw UTC string pushes every call between 00:00 and 05:29 IST
// into the previous day and shifts the demand curve by five and a half hours.
const config = require('../config');

/** Parses "+05:30" / "-04:00" / "330" into minutes east of UTC. */
function parseOffsetMinutes(value, fallback = 330) {
  if (value === undefined || value === null || value === '') return fallback;
  if (/^-?\d+$/.test(String(value).trim())) return Number(value);

  const m = String(value).trim().match(/^([+-])(\d{2}):?(\d{2})$/);
  if (!m) return fallback;
  const [, sign, hours, minutes] = m;
  const total = Number(hours) * 60 + Number(minutes);
  return sign === '-' ? -total : total;
}

const offsetMinutes = () => config.reportOffsetMinutes;

/** SQLite modifier that shifts a stored UTC timestamp into reporting time. */
function shift() {
  const mins = offsetMinutes();
  return `'${mins >= 0 ? '+' : '-'}${Math.abs(mins)} minutes'`;
}

/** SQL expression yielding the local calendar day (YYYY-MM-DD) of a column. */
const localDay = (column) => `substr(datetime(${column}, ${shift()}), 1, 10)`;

/** SQL expression yielding the local hour of day (00-23) of a column. */
const localHour = (column) => `substr(datetime(${column}, ${shift()}), 12, 2)`;

/** Today's date in reporting time. */
function todayLocal(now = new Date()) {
  return new Date(now.getTime() + offsetMinutes() * 60_000).toISOString().slice(0, 10);
}

/** A date `days` before today, in reporting time. */
function daysAgoLocal(days, now = new Date()) {
  return new Date(now.getTime() + offsetMinutes() * 60_000 - days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/** Human-readable label for the window shown alongside a report. */
function offsetLabel() {
  const mins = offsetMinutes();
  const sign = mins >= 0 ? '+' : '-';
  const abs = Math.abs(mins);
  return `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

module.exports = { parseOffsetMinutes, localDay, localHour, todayLocal, daysAgoLocal, offsetLabel };
