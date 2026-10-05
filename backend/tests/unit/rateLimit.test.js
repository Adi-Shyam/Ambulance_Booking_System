'use strict';
// Unit tests - brute-force limiter (NF.3).
// The middleware is exercised directly with stub request/response objects, so
// the behaviour is tested without an HTTP server.
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { useTempDatabase } = require('./bootstrap');

useTempDatabase('ratelimit');

const { rateLimit, resetRateLimits } = require('../../src/middleware/rateLimit');

/** Minimal Express-like request/response pair. */
function exchange(body = {}, ip = '10.0.0.1') {
  const res = {
    statusCode: 200,
    headers: {},
    payload: null,
    finished: false,
    set(k, v) { this.headers[k] = v; return this; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; this.finish(); return this; },
    on(event, cb) { if (event === 'finish') this._onFinish = cb; },
    finish() { if (!this.finished) { this.finished = true; this._onFinish?.(); } },
  };
  return { req: { ip, body }, res };
}

/** Runs the limiter once; returns true when the request was allowed through. */
function attempt(limiter, body, { ip, outcome = 200 } = {}) {
  const { req, res } = exchange(body, ip);
  let passed = false;
  limiter(req, res, () => { passed = true; });
  if (passed) {
    res.statusCode = outcome;   // simulate what the route decided
    res.finish();
  }
  return { passed, res };
}

beforeEach(() => resetRateLimits());

describe('counting every attempt', () => {
  const limiter = () => rateLimit({ max: 3, windowMs: 60_000, message: 'slow down' });

  test('allows attempts up to the limit', () => {
    const l = limiter();
    for (let i = 0; i < 3; i += 1) {
      assert.equal(attempt(l, { phone_no: '9800000001' }).passed, true, `attempt ${i + 1}`);
    }
  });

  test('blocks the attempt after the limit', () => {
    const l = limiter();
    for (let i = 0; i < 3; i += 1) attempt(l, { phone_no: '9800000001' });

    const { passed, res } = attempt(l, { phone_no: '9800000001' });
    assert.equal(passed, false);
    assert.equal(res.statusCode, 429);
    assert.equal(res.payload.error, 'slow down');
  });

  test('tells the caller when to come back', () => {
    const l = limiter();
    for (let i = 0; i < 4; i += 1) attempt(l, { phone_no: '9800000001' });

    const { res } = attempt(l, { phone_no: '9800000001' });
    assert.ok(res.payload.retry_after_seconds > 0);
    assert.ok(Number(res.headers['Retry-After']) > 0, 'a Retry-After header is set');
  });
});

describe('counters are scoped, not global', () => {
  test('one account being throttled does not lock out another', () => {
    const l = rateLimit({ max: 2, windowMs: 60_000 });
    attempt(l, { phone_no: '9800000001' });
    attempt(l, { phone_no: '9800000001' });
    assert.equal(attempt(l, { phone_no: '9800000001' }).passed, false, 'first account is blocked');
    assert.equal(attempt(l, { phone_no: '9800000002' }).passed, true, 'second account is unaffected');
  });

  test('the same account from a different address counts separately', () => {
    const l = rateLimit({ max: 1, windowMs: 60_000 });
    attempt(l, { phone_no: '9800000001' }, { ip: '10.0.0.1' });
    assert.equal(attempt(l, { phone_no: '9800000001' }, { ip: '10.0.0.1' }).passed, false);
    assert.equal(attempt(l, { phone_no: '9800000001' }, { ip: '10.0.0.2' }).passed, true);
  });

  test('a custom key can widen the scope to the whole address', () => {
    const l = rateLimit({ max: 1, windowMs: 60_000, key: (req) => req.ip });
    attempt(l, { phone_no: '9800000001' });
    assert.equal(attempt(l, { phone_no: '9800000009' }).passed, false,
      'a per-IP limiter ignores which account is targeted');
  });
});

describe('failure-only counting', () => {
  const limiter = () => rateLimit({ max: 2, windowMs: 60_000, countSuccess: false });

  test('successful attempts are not charged', () => {
    const l = limiter();
    for (let i = 0; i < 10; i += 1) {
      assert.equal(attempt(l, { phone_no: '9800000001' }, { outcome: 200 }).passed, true,
        'a valid sign-in must never lock the user out');
    }
  });

  test('failed attempts are charged and eventually block', () => {
    const l = limiter();
    attempt(l, { phone_no: '9800000001' }, { outcome: 401 });
    attempt(l, { phone_no: '9800000001' }, { outcome: 401 });
    assert.equal(attempt(l, { phone_no: '9800000001' }).passed, false);
  });

  test('a mix of outcomes only counts the failures', () => {
    const l = limiter();
    attempt(l, { phone_no: '9800000001' }, { outcome: 401 });
    attempt(l, { phone_no: '9800000001' }, { outcome: 200 });
    assert.equal(attempt(l, { phone_no: '9800000001' }, { outcome: 401 }).passed, true,
      'one success in between must not consume the allowance');
    assert.equal(attempt(l, { phone_no: '9800000001' }).passed, false);
  });
});

describe('the window expires', () => {
  test('the allowance returns once the window has passed', async () => {
    const l = rateLimit({ max: 1, windowMs: 120 });
    attempt(l, { phone_no: '9800000001' });
    assert.equal(attempt(l, { phone_no: '9800000001' }).passed, false);

    await new Promise((r) => setTimeout(r, 160));
    assert.equal(attempt(l, { phone_no: '9800000001' }).passed, true,
      'a lockout must be temporary, not permanent');
  });
});
