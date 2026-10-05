'use strict';
// Brute-force protection for the credential endpoints (NF.3).
//
// Without this a six-digit OTP is exhaustible in minutes and a password can be
// guessed without limit. Counters are held in memory, which is the right shape
// for a single-process deployment; a multi-instance deployment would move the
// same counters to Redis without changing the call sites.

const buckets = new Map();

/** Identifies the caller. Prefers the account being targeted over the IP. */
function defaultKey(req) {
  const subject = req.body?.phone_no || req.body?.email_id || '';
  return `${req.ip}|${String(subject).replace(/[^0-9a-z@.]/gi, '')}`;
}

function sweep(now) {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

/**
 * @param {object} options
 * @param {number} options.max      attempts allowed inside the window
 * @param {number} options.windowMs length of the window
 * @param {string} options.message  what the caller is told when blocked
 * @param {(req) => string} [options.key]
 * @param {boolean} [options.countSuccess] false = only failures count, so a
 *        legitimate user typing one wrong password is never locked out by
 *        their own subsequent successful logins.
 */
function rateLimit({ max, windowMs, message, key = defaultKey, countSuccess = true }) {
  return function limiter(req, res, next) {
    const now = Date.now();
    if (buckets.size > 5000) sweep(now);

    const id = key(req);
    let bucket = buckets.get(id);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(id, bucket);
    }

    if (bucket.count >= max) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({
        error: message || 'Too many attempts. Please wait and try again.',
        retry_after_seconds: retryAfter,
      });
    }

    if (countSuccess) {
      bucket.count += 1;
      return next();
    }

    // Charge the bucket only when the handler rejects the attempt.
    res.on('finish', () => {
      if (res.statusCode >= 400) bucket.count += 1;
    });
    next();
  };
}

/** Test helper - drops all counters. */
function resetRateLimits() {
  buckets.clear();
}

module.exports = { rateLimit, resetRateLimits };
