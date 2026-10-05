'use strict';
// F.2 / NF.3 - stateless JWT authentication plus role-based access control.
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const config = require('../config');
const { db } = require('../db');

/**
 * Issues a session token and records it in D1 (DFD 0.1.3 Create Session &
 * Assign Role). Persisting it is what makes a session revocable: a JWT alone
 * cannot be withdrawn before it expires.
 */
function issueToken(user, provider) {
  const token_id = crypto.randomUUID();
  const payload = {
    jti: token_id,
    sub: user.user_id,
    role: user.role_code,
    phone: user.phone_no,
    name: user.full_name,
    orgId: user.org_id || null,
    providerId: provider?.provider_id || null,
  };

  const token = jwt.sign(payload, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
    algorithm: 'HS256',
  });

  const decoded = jwt.decode(token);
  const issued_at = new Date(decoded.iat * 1000).toISOString();
  const token_expiry = new Date(decoded.exp * 1000).toISOString();

  db.prepare(
    `INSERT INTO sessions (token_id, user_id, role_code, issued_at, token_expiry)
     VALUES (?, ?, ?, ?, ?)`
  ).run(token_id, user.user_id, user.role_code, issued_at, token_expiry);

  return { session_token: token, token_expiry, token_id };
}

/** Marks one session as revoked, so its token stops being accepted. */
function revokeSession(tokenId) {
  const result = db.prepare(
    'UPDATE sessions SET revoked = 1, revoked_at = ? WHERE token_id = ? AND revoked = 0'
  ).run(new Date().toISOString(), tokenId);
  return result.changes > 0;
}

/** Verifies the bearer token and loads the current user + provider profile. */
function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authentication required' });

  let claims;
  try {
    claims = jwt.verify(token, config.jwtSecret);
  } catch (err) {
    const expired = err.name === 'TokenExpiredError';
    return res.status(401).json({ error: expired ? 'Session expired, please sign in again' : 'Invalid session token' });
  }

  // A signature that verifies is not enough: the session must still be live in
  // D1. This is what lets a sign-out, or an administrator, end a session before
  // its 24-hour expiry.
  if (claims.jti) {
    const session = db.prepare('SELECT revoked FROM sessions WHERE token_id = ?').get(claims.jti);
    if (session && session.revoked) {
      return res.status(401).json({ error: 'This session has been signed out. Please sign in again.' });
    }
  }

  const user = db.prepare('SELECT * FROM users WHERE user_id = ?').get(claims.sub);
  if (!user) return res.status(401).json({ error: 'Account no longer exists' });
  if (user.verification_status === 'SUSPENDED') {
    return res.status(403).json({ error: 'This account has been suspended by an administrator' });
  }

  req.user = user;
  req.claims = claims;
  req.provider = db.prepare('SELECT * FROM providers WHERE user_id = ?').get(user.user_id) || null;
  next();
}

/** Restricts a route to one or more role codes (RBAC). */
function requireRole(...roles) {
  const allowed = roles.flat();
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    if (!allowed.includes(req.user.role_code)) {
      return res.status(403).json({ error: `This action requires the ${allowed.join(' or ')} role` });
    }
    next();
  };
}

/** Driver/organisation routes additionally need a verified provider profile. */
function requireProvider(req, res, next) {
  if (!req.provider) {
    return res.status(403).json({ error: 'Complete your ambulance profile before using this feature' });
  }
  if (req.provider.verification_status !== 'VERIFIED') {
    return res.status(403).json({
      error: `Your ambulance profile is ${req.provider.verification_status.toLowerCase()}. An administrator must verify it first.`,
      verification_status: req.provider.verification_status,
    });
  }
  next();
}

module.exports = { issueToken, revokeSession, authenticate, requireRole, requireProvider };
