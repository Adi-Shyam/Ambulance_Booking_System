'use strict';
// Unit tests - identifier generation (Data Dictionary section 2).
const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const { useTempDatabase } = require('./bootstrap');

useTempDatabase('ids');

const { migrate } = require('../../src/db');
const { nextId, messageId, FORMATS } = require('../../src/utils/ids');

before(() => migrate());

describe('identifier formats', () => {
  const cases = [
    ['user', /^U[0-9]{8}$/],
    ['provider', /^P[0-9]{8}$/],
    ['org', /^O[0-9]{6}$/],
    ['booking', /^BK[0-9]{8}$/],
    ['assignment', /^AS[0-9]{8}$/],
    ['trip', /^TR[0-9]{8}$/],
    ['invoice', /^INV[0-9]{8}$/],
    ['report', /^RPT[0-9]{6}$/],
  ];

  for (const [kind, pattern] of cases) {
    test(`${kind} ids match ${pattern}`, () => {
      assert.match(nextId(kind), pattern);
    });
  }

  test('every documented kind has a format', () => {
    assert.deepEqual(
      Object.keys(FORMATS).sort(),
      ['assignment', 'booking', 'invoice', 'org', 'provider', 'report', 'trip', 'user']
    );
  });

  test('an unknown kind is rejected rather than guessed at', () => {
    assert.throws(() => nextId('spaceship'), /Unknown id kind/);
  });
});

describe('identifier sequencing', () => {
  test('ids increase by exactly one within a kind', () => {
    const a = Number(nextId('booking').slice(2));
    const b = Number(nextId('booking').slice(2));
    assert.equal(b, a + 1, 'the audit trail relies on a gap-free sequence (C.5)');
  });

  test('each kind counts independently', () => {
    const bookingBefore = Number(nextId('booking').slice(2));
    nextId('trip');
    nextId('trip');
    const bookingAfter = Number(nextId('booking').slice(2));
    assert.equal(bookingAfter, bookingBefore + 1, 'trips must not advance the booking counter');
  });

  test('ids stay zero-padded to the specified width', () => {
    const id = nextId('user');
    assert.equal(id.length, 1 + 8);
    assert.match(id, /^U0*\d+$/);
  });

  test('no two ids of a kind repeat across many draws', () => {
    const seen = new Set();
    for (let i = 0; i < 200; i += 1) seen.add(nextId('assignment'));
    assert.equal(seen.size, 200);
  });
});

describe('message identifiers', () => {
  test('message ids are unique and prefixed', () => {
    const ids = new Set(Array.from({ length: 500 }, () => messageId()));
    assert.equal(ids.size, 500, 'delivery receipts are correlated by this id (F.6)');
    for (const id of ids) assert.match(id, /^MSG/);
  });
});
