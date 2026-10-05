'use strict';
// Unit tests - reporting calendar (F.13).
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { useTempDatabase } = require('./bootstrap');

useTempDatabase('localdate');

const { parseOffsetMinutes, localDay, localHour, todayLocal, daysAgoLocal, offsetLabel } =
  require('../../src/utils/localDate');

describe('timezone offset parsing', () => {
  test('accepts the +HH:MM form', () => {
    assert.equal(parseOffsetMinutes('+05:30'), 330);
    assert.equal(parseOffsetMinutes('-04:00'), -240);
  });

  test('accepts a plain minute count', () => {
    assert.equal(parseOffsetMinutes('330'), 330);
    assert.equal(parseOffsetMinutes('-90'), -90);
  });

  test('accepts the compact +HHMM form', () => {
    assert.equal(parseOffsetMinutes('+0530'), 330);
  });

  test('falls back rather than throwing on nonsense', () => {
    assert.equal(parseOffsetMinutes('tea time', 330), 330);
    assert.equal(parseOffsetMinutes('', 330), 330);
    assert.equal(parseOffsetMinutes(undefined, 330), 330);
  });
});

describe('SQL bucket expressions', () => {
  test('the day expression shifts by the configured offset', () => {
    assert.equal(localDay('booking_timestamp'),
      "substr(datetime(booking_timestamp, '+330 minutes'), 1, 10)");
  });

  test('the hour expression selects the two-digit hour', () => {
    assert.equal(localHour('booking_timestamp'),
      "substr(datetime(booking_timestamp, '+330 minutes'), 12, 2)");
  });

  test('the expression accepts a qualified column name', () => {
    assert.match(localDay('b.booking_timestamp'), /b\.booking_timestamp/);
  });
});

describe('calendar arithmetic', () => {
  test('a UTC instant late on one day is the next local day in IST', () => {
    // 21:30 UTC is 03:00 IST the following morning.
    assert.equal(todayLocal(new Date('2026-08-31T21:30:00Z')), '2026-09-01');
  });

  test('a UTC instant early in the day stays on the same local day', () => {
    assert.equal(todayLocal(new Date('2026-09-01T06:00:00Z')), '2026-09-01');
  });

  test('the boundary is exactly 18:30 UTC for IST', () => {
    assert.equal(todayLocal(new Date('2026-09-01T18:29:59Z')), '2026-09-01');
    assert.equal(todayLocal(new Date('2026-09-01T18:30:00Z')), '2026-09-02');
  });

  test('a window start counts back whole days', () => {
    assert.equal(daysAgoLocal(0, new Date('2026-09-07T10:00:00Z')), '2026-09-07');
    assert.equal(daysAgoLocal(6, new Date('2026-09-07T10:00:00Z')), '2026-09-01');
    assert.equal(daysAgoLocal(29, new Date('2026-09-07T10:00:00Z')), '2026-08-09');
  });

  test('the label reports the offset a reader can check', () => {
    assert.equal(offsetLabel(), 'UTC+05:30');
  });
});
