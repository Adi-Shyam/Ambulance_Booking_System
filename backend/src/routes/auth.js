'use strict';
// F.1 Registration and authentication, F.2 Role-based login.
// DFD processes 0.1.1 Register & Verify OTP, 0.1.2 Authenticate Credentials,
// 0.1.3 Create Session & Assign Role.
const express = require('express');
const bcrypt = require('bcryptjs');
const config = require('../config');
const { db, nowIso, audit } = require('../db');
const { nextId } = require('../utils/ids');
const v = require('../utils/validate');
const { issueToken, revokeSession, authenticate } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rateLimit');
const messaging = require('../services/messaging');

const router = express.Router();

// NF.3 brute-force limits. Sign-in counts only failed attempts, so someone
// signing in repeatedly on a shared network is never penalised; OTP issue and
// OTP verification count every attempt, because both are the expensive ones to
// leave open (an unlimited verify makes a 6-digit code exhaustible).
const loginLimiter = rateLimit({
  max: 8,
  windowMs: 10 * 60_000,
  countSuccess: false,
  message: 'Too many failed sign-in attempts. Please wait 10 minutes and try again.',
});

const otpRequestLimiter = rateLimit({
  max: 5,
  windowMs: 15 * 60_000,
  message: 'Too many verification codes requested. Please wait 15 minutes.',
});

const otpVerifyLimiter = rateLimit({
  max: 6,
  windowMs: 15 * 60_000,
  message: 'Too many incorrect verification codes. Please request a new one shortly.',
});

const registerLimiter = rateLimit({
  max: config.registerLimitPerHour,
  windowMs: 60 * 60_000,
  key: (req) => req.ip,
  message: 'Too many accounts created from this device. Please try again later.',
});

const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const OTP_TTL_MS = 5 * 60 * 1000; // Data Dictionary: issue time + 5 min
const findUserByPhone = (phone) => db.prepare('SELECT * FROM users WHERE phone_no = ?').get(phone);
const findUserByEmail = (email) =>
  db.prepare('SELECT * FROM users WHERE email_id = ?').get(String(email).trim().toLowerCase());

function sessionResponse(user) {
  const provider = db.prepare('SELECT * FROM providers WHERE user_id = ?').get(user.user_id) || null;
  const { session_token, token_expiry } = issueToken(user, provider);
  return {
    session_token,
    token_expiry,
    user: {
      user_id: user.user_id,
      full_name: user.full_name,
      phone_no: user.phone_no,
      email_id: user.email_id,
      // Which contact details have actually been proved. The app shows this
      // rather than letting a collected number look like a checked one.
      email_verified: Boolean(user.email_verified),
      phone_verified: Boolean(user.phone_verified),
      role_code: user.role_code,
      verification_status: user.verification_status,
      registration_date: user.registration_date,
      org_id: user.org_id,
    },
    provider,
  };
}

// ------------------------------------------------- 0.1.1 register + verify
/**
 * Starts a registration. It does not finish one.
 *
 * Everything is checked here - the name, the number, the address, the
 * password, and that neither identifier is already taken - so somebody learns
 * their email is in use before waiting on a code rather than after. Then a
 * code goes to the address, and `/otp/verify` is what actually creates the
 * account.
 *
 * Splitting it this way is the whole point: an account cannot exist with an
 * address nobody has proved. Creating one here and emailing afterwards would
 * leave a real account behind whether or not the address was ever read, which
 * is exactly the hole this closes.
 */
router.post('/register', registerLimiter, asyncRoute(async (req, res) => {
  const full_name = v.name(req.body.full_name);
  const phone_no = v.phone(req.body.phone_no);
  // Required, not optional: an address is how an account is reached and how it
  // is proved. The number beside it is contact data for the crew, and nothing
  // checks that it is real - see `phone_verified`.
  const email_id = v.email(v.required(req.body.email_id, 'email_id'));
  const role_code = v.oneOf(req.body.role_code || 'USER', ['USER', 'DRIVER', 'ORG'], 'role_code');
  // Validated now so a weak one is rejected before a code is spent, but not
  // stored: the client holds it and sends it back with the code. Keeping an
  // unverified password hash lying about would be storing a credential for an
  // account that may never exist.
  //
  // The details go with it so the check can refuse a password that is simply
  // their own name, number or address - a common choice, and the first guess
  // of anyone who knows them.
  v.newPassword(req.body.password, 'password', { full_name, phone_no, email_id });

  if (findUserByPhone(phone_no)) {
    return res.status(409).json({
      error: 'An account already exists for this mobile number',
      field: 'phone_no',
    });
  }
  if (findUserByEmail(email_id)) {
    return res.status(409).json({
      error: 'An account already exists for this email address',
      field: 'email_id',
    });
  }

  const otp_code = String(Math.floor(100000 + Math.random() * 900000));
  const otp_expiry = new Date(Date.now() + OTP_TTL_MS).toISOString();

  db.prepare('UPDATE otps SET consumed = 1 WHERE identifier = ? AND consumed = 0').run(email_id);
  db.prepare(
    `INSERT INTO otps (identifier, identifier_type, otp_code, otp_expiry, purpose,
                       channel, destination, created_at)
     VALUES (?, 'EMAIL', ?, ?, 'REGISTER', 'EMAIL', ?, ?)`
  ).run(email_id, otp_code, otp_expiry, email_id, nowIso());

  await messaging.sendOtp({ phoneNo: phone_no, otpCode: otp_code, channel: 'EMAIL', emailId: email_id });
  audit('OTP_ISSUED', {
    entityType: 'email', entityId: email_id,
    details: { purpose: 'REGISTER', channel: 'EMAIL', role_code },
  });

  // 202: understood and under way, but nothing has been created yet.
  res.status(202).json({
    message: 'Check your email for a 6-digit code to finish creating your account',
    needs_verification: true,
    channel: 'EMAIL',
    verifying: 'EMAIL',
    sent_to: messaging.maskDestination(email_id, 'EMAIL'),
    otp_expiry,
    ...(config.exposeOtp ? { otp_code, dev_note: 'otp_code is exposed because EXPOSE_OTP_IN_RESPONSE=true' } : {}),
  });
}));

// Passwordless / verification OTP
//
// A code proves control of one contact detail, so the request names the detail
// rather than the account: `email_id` to verify an address, `phone_no` to
// verify a number. Registration uses the email, because an email can be
// verified for nothing while proving a phone number needs an SMS gateway or an
// unblocked WhatsApp sender.
router.post('/otp/request', otpRequestLimiter, asyncRoute(async (req, res) => {
  const purpose = String(req.body.purpose || 'LOGIN').toUpperCase();

  const email_id = req.body.email_id ? v.email(req.body.email_id) : null;
  const phone_no = req.body.phone_no ? v.phone(req.body.phone_no) : null;

  if (!email_id && !phone_no) {
    return res.status(400).json({
      error: 'Send the email address to verify.',
      field: 'email_id',
    });
  }

  // What is being verified, and how the code travels to it. Verifying an
  // address can only go by email; verifying a number defaults to WhatsApp but
  // may be emailed to an account that already has an address on file.
  const identifier_type = email_id ? 'EMAIL' : 'PHONE';
  const identifier = email_id || phone_no;

  const existing = email_id ? findUserByEmail(email_id) : findUserByPhone(phone_no);
  if (purpose === 'LOGIN' && !existing) {
    return res.status(404).json({
      error: email_id
        ? 'No account found for this email address'
        : 'No account found for this mobile number',
    });
  }

  let channel = v.oneOf(
    String(req.body.channel || (email_id ? 'EMAIL' : 'WHATSAPP')).toUpperCase(),
    ['WHATSAPP', 'EMAIL'], 'channel'
  );
  if (identifier_type === 'EMAIL') channel = 'EMAIL';   // nothing else reaches an address

  // Where the code actually goes. Verifying a number by email uses the address
  // already on that account; there is nowhere else it could go.
  let destination = identifier;
  if (channel === 'EMAIL' && identifier_type === 'PHONE') {
    destination = existing?.email_id || null;
    if (!destination) {
      return res.status(400).json({
        error: 'This account has no email address on file. Ask for the code by WhatsApp instead.',
        field: 'email_id',
      });
    }
  }

  const otp_code = String(Math.floor(100000 + Math.random() * 900000));
  const otp_expiry = new Date(Date.now() + OTP_TTL_MS).toISOString();

  db.prepare('UPDATE otps SET consumed = 1 WHERE identifier = ? AND consumed = 0').run(identifier);
  db.prepare(
    `INSERT INTO otps (identifier, identifier_type, otp_code, otp_expiry, purpose,
                       channel, destination, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(identifier, identifier_type, otp_code, otp_expiry, purpose, channel, destination, nowIso());

  await messaging.sendOtp({
    phoneNo: phone_no || existing?.phone_no || null,
    otpCode: otp_code,
    channel,
    emailId: channel === 'EMAIL' ? destination : null,
  });
  audit('OTP_ISSUED', {
    entityType: identifier_type.toLowerCase(),
    entityId: identifier,
    details: { purpose, channel },
  });

  res.json({
    message: channel === 'EMAIL' ? 'Verification code emailed' : 'Verification code sent',
    channel,
    verifying: identifier_type,
    // Masked: enough to recognise where to look, without handing a full
    // address or number back to whoever asked for the code.
    sent_to: messaging.maskDestination(destination, channel),
    otp_expiry,
    // Development convenience only - see EXPOSE_OTP_IN_RESPONSE in .env
    ...(config.exposeOtp ? { otp_code, dev_note: 'otp_code is exposed because EXPOSE_OTP_IN_RESPONSE=true' } : {}),
  });
}));

router.post('/otp/verify', otpVerifyLimiter, asyncRoute(async (req, res) => {
  const otp_code = String(v.required(req.body.otp_code, 'otp_code')).trim();
  const email_id = req.body.email_id ? v.email(req.body.email_id) : null;
  const phone_no = req.body.phone_no ? v.phone(req.body.phone_no) : null;

  if (!email_id && !phone_no) {
    return res.status(400).json({ error: 'Send the email address being verified.', field: 'email_id' });
  }

  // Whichever detail the code was issued against - the same one it proves.
  const identifier = email_id || phone_no;

  const row = db.prepare(
    'SELECT * FROM otps WHERE identifier = ? AND consumed = 0 ORDER BY id DESC LIMIT 1'
  ).get(identifier);

  if (!row || row.otp_code !== otp_code) {
    return res.status(401).json({ error: 'Incorrect verification code' });
  }
  if (new Date(row.otp_expiry).getTime() < Date.now()) {
    return res.status(401).json({ error: 'This verification code has expired' });
  }

  const verifyingEmail = row.identifier_type === 'EMAIL';
  let user = verifyingEmail ? findUserByEmail(identifier) : findUserByPhone(identifier);

  // F.1: a verified code on an address nobody holds is a registration, not a
  // dead end. The schema allows a NULL password_hash precisely for these -
  // they sign in by code every time rather than holding a password they never
  // set.
  //
  // Everything that can refuse this request is settled *before* the code is
  // consumed, because the sign-in screen asks twice: once with the code, and
  // again with the details the first reply asked for. Consuming on the first
  // of those would leave the second with no code to present.
  let full_name = null;
  let role_code = null;
  let new_phone = null;
  let new_password = null;
  if (!user) {
    if (!verifyingEmail) {
      // A phone code is for proving a number on an account that exists. There
      // is no registration path here, because a number cannot be verified for
      // free and an account built on an unproven one would mean nothing.
      return res.status(404).json({ error: 'No account found for this mobile number' });
    }

    full_name = req.body.full_name ? v.name(req.body.full_name) : null;
    new_phone = req.body.phone_no ? v.phone(req.body.phone_no) : null;
    // Optional: the registration form sends one, the code-only path does not.
    // The schema allows a NULL hash for accounts that sign in by code every
    // time rather than holding a password they never chose.
    new_password = req.body.password
      ? v.newPassword(req.body.password, 'password', {
          full_name, phone_no: new_phone, email_id: identifier,
        })
      : null;

    if (!full_name || !new_phone) {
      return res.status(404).json({
        error: 'This email address has no account yet. Send your name and mobile number to create one.',
        needs_registration: true,
        // Naming what is missing lets the screen ask for exactly that.
        missing: [...(full_name ? [] : ['full_name']), ...(new_phone ? [] : ['phone_no'])],
      });
    }

    // The crew ring this number when they cannot find the patient, so it has
    // to belong to somebody - even though nothing here proves it does.
    if (findUserByPhone(new_phone)) {
      return res.status(409).json({
        error: 'That mobile number is already registered to another account',
        field: 'phone_no',
      });
    }

    // Never by code: an administrator is created by another administrator
    // (F.13), and a provider still has to submit a vehicle for verification.
    role_code = v.oneOf(req.body.role_code || 'USER', ['USER', 'DRIVER', 'ORG'], 'role_code');
  }

  // Single use from here on: the code has done its job and cannot be replayed.
  db.prepare('UPDATE otps SET consumed = 1 WHERE id = ?').run(row.id);

  if (!user) {
    const now = nowIso();
    const user_id = nextId('user');

    db.prepare(
      `INSERT INTO users (user_id, full_name, phone_no, email_id, email_verified, phone_verified,
                          password_hash, role_code, verification_status, registration_date,
                          created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, 0, ?, ?, ?, ?, ?, ?)`
    ).run(
      user_id, full_name, new_phone, identifier,
      new_password ? bcrypt.hashSync(new_password, 12) : null,   // bcrypt, cost 12
      role_code,
      role_code === 'USER' ? 'VERIFIED' : 'PENDING',
      now.slice(0, 10), now, now
    );

    audit('USER_REGISTERED', {
      actorUserId: user_id, actorRole: role_code, entityType: 'user', entityId: user_id,
      details: {
        email_id: identifier, role_code, channel: row.channel,
        via: new_password ? 'registration form' : 'code only',
      },
    });

    user = findUserByEmail(identifier);
    return res.status(201).json({ message: 'Account created', ...sessionResponse(user) });
  }

  // An existing account: the code proves whichever detail it was issued
  // against, and only that one.
  db.prepare(
    `UPDATE users SET ${verifyingEmail ? 'email_verified' : 'phone_verified'} = 1, updated_at = ?
     WHERE user_id = ?`
  ).run(nowIso(), user.user_id);

  if (user.verification_status === 'PENDING' && user.role_code === 'USER') {
    db.prepare('UPDATE users SET verification_status = ?, updated_at = ? WHERE user_id = ?')
      .run('VERIFIED', nowIso(), user.user_id);
  }

  audit('OTP_VERIFIED', {
    actorUserId: user.user_id, entityType: 'user', entityId: user.user_id,
    details: { verified: row.identifier_type },
  });
  res.json({
    message: verifyingEmail ? 'Email verified' : 'Mobile number verified',
    verified: row.identifier_type,
    ...sessionResponse(db.prepare('SELECT * FROM users WHERE user_id = ?').get(user.user_id)),
  });
}));

// --------------------------------------- 0.1.2 + 0.1.3 login, session, role
router.post('/login', loginLimiter, asyncRoute(async (req, res) => {
  // Either identifier signs in. An account registered by email knows its
  // address, not necessarily its own number as typed, and seeded accounts
  // predate addresses entirely - so neither can be the only way in.
  const email_id = req.body.email_id ? v.email(req.body.email_id) : null;
  const phone_no = req.body.phone_no ? v.phone(req.body.phone_no) : null;
  if (!email_id && !phone_no) {
    return res.status(400).json({ error: 'Send an email address or a mobile number', field: 'email_id' });
  }
  const password = v.password(req.body.password);
  const expectedRole = req.body.role_code
    ? v.oneOf(req.body.role_code, v.ROLE_CODES, 'role_code')
    : null;

  const user = email_id ? findUserByEmail(email_id) : findUserByPhone(phone_no);
  if (!user || !user.password_hash || !bcrypt.compareSync(password, user.password_hash)) {
    // The same message either way: saying which half was wrong tells an
    // attacker which addresses and numbers have accounts (NF.3).
    audit('LOGIN_FAILED', { entityType: email_id ? 'email' : 'phone', entityId: email_id || phone_no });
    return res.status(401).json({
      error: email_id ? 'Incorrect email address or password' : 'Incorrect mobile number or password',
    });
  }
  if (user.verification_status === 'SUSPENDED') {
    return res.status(403).json({ error: 'This account has been suspended by an administrator' });
  }
  // F.2: the selected mode must match the role granted to the account.
  if (expectedRole && expectedRole !== user.role_code) {
    // The article travels with the noun: "an organisation", not "a organisation".
    const readable = { USER: 'a patient', DRIVER: 'a driver', ORG: 'an organisation', ADMIN: 'an administrator' };
    return res.status(403).json({
      error: `This account is registered as ${readable[user.role_code]}. Choose that mode to sign in.`,
      role_code: user.role_code,
    });
  }

  audit('LOGIN_SUCCESS', {
    actorUserId: user.user_id, actorRole: user.role_code, entityType: 'user', entityId: user.user_id,
  });
  res.json({ message: 'Signed in', ...sessionResponse(user) });
}));

/**
 * Ends the current session by revoking its record in D1. Clearing the token on
 * the device alone would leave a still-valid token in existence for up to 24
 * hours; revoking it here means the server stops honouring it immediately.
 */
router.post('/logout', authenticate, asyncRoute(async (req, res) => {
  const revoked = req.claims.jti ? revokeSession(req.claims.jti) : false;
  audit('LOGOUT', {
    actorUserId: req.user.user_id, actorRole: req.user.role_code,
    entityType: 'session', entityId: req.claims.jti || null,
  });
  res.json({ message: 'Signed out', revoked });
}));

/** The account's own session history - what D1 now holds about their logins. */
router.get('/sessions', authenticate, asyncRoute(async (req, res) => {
  const sessions = db.prepare(
    `SELECT token_id, role_code, issued_at, token_expiry, revoked, revoked_at
     FROM sessions WHERE user_id = ? ORDER BY id DESC LIMIT 25`
  ).all(req.user.user_id);

  res.json({
    sessions: sessions.map((s) => ({ ...s, current: s.token_id === req.claims.jti })),
  });
}));

router.get('/me', authenticate, (req, res) => {
  res.json({
    user: {
      user_id: req.user.user_id,
      full_name: req.user.full_name,
      phone_no: req.user.phone_no,
      email_id: req.user.email_id,
      email_verified: Boolean(req.user.email_verified),
      phone_verified: Boolean(req.user.phone_verified),
      role_code: req.user.role_code,
      verification_status: req.user.verification_status,
      registration_date: req.user.registration_date,
      org_id: req.user.org_id,
    },
    provider: req.provider,
    organisation: req.user.org_id
      ? db.prepare('SELECT * FROM organisations WHERE org_id = ?').get(req.user.org_id)
      : null,
  });
});

router.patch('/me', authenticate, asyncRoute(async (req, res) => {
  const full_name = req.body.full_name ? v.name(req.body.full_name) : req.user.full_name;
  const email_id = req.body.email_id !== undefined ? v.email(req.body.email_id) : req.user.email_id;

  db.prepare('UPDATE users SET full_name = ?, email_id = ?, updated_at = ? WHERE user_id = ?')
    .run(full_name, email_id, nowIso(), req.user.user_id);

  audit('PROFILE_UPDATED', { actorUserId: req.user.user_id, entityType: 'user', entityId: req.user.user_id });
  res.json({ message: 'Profile updated', user: db.prepare('SELECT * FROM users WHERE user_id = ?').get(req.user.user_id) });
}));

router.post('/password', authenticate, asyncRoute(async (req, res) => {
  const next = v.newPassword(req.body.new_password, 'new_password', {
    full_name: req.user.full_name,
    phone_no: req.user.phone_no,
    email_id: req.user.email_id,
  });

  // An account registered by OTP has no password to confirm, and demanding one
  // would strand it on code-only sign-in for ever. The bearer token is already
  // proof of identity here, so setting the first password needs nothing more.
  const settingFirstPassword = !req.user.password_hash;

  if (!settingFirstPassword) {
    const current = String(v.required(req.body.current_password, 'current_password'));
    if (!bcrypt.compareSync(current, req.user.password_hash)) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
  }

  db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE user_id = ?')
    .run(bcrypt.hashSync(next, 12), nowIso(), req.user.user_id);

  audit(settingFirstPassword ? 'PASSWORD_SET' : 'PASSWORD_CHANGED', {
    actorUserId: req.user.user_id, entityType: 'user', entityId: req.user.user_id,
  });
  res.json({
    message: settingFirstPassword ? 'Password set' : 'Password updated',
    first_password: settingFirstPassword,
  });
}));

// ------------------------------------------------- forgotten password (F.1)
/**
 * Sends a reset code to an address.
 *
 * The reply is the same whether or not an account exists. Saying "no account
 * found" would turn this into a way to ask the server which addresses are
 * registered, one address at a time, without signing in to anything (NF.3).
 * Somebody who mistypes their own address learns it from the email that never
 * arrives, which is the cost of not answering that question for everyone else.
 *
 * The code is issued with purpose RESET and `/password/reset` accepts no
 * other, so a sign-in code read over somebody's shoulder cannot be turned
 * into a password change.
 */
router.post('/password/forgot', otpRequestLimiter, asyncRoute(async (req, res) => {
  const email_id = v.email(v.required(req.body.email_id, 'email_id'));
  const neutral = {
    message: 'If that address has an account, a reset code is on its way to it',
    sent_to: messaging.maskDestination(email_id, 'EMAIL'),
  };

  const user = findUserByEmail(email_id);
  if (!user) {
    audit('PASSWORD_RESET_REQUESTED', {
      entityType: 'email', entityId: email_id, details: { account: 'none' },
    });
    return res.json(neutral);
  }

  if (user.verification_status === 'SUSPENDED') {
    // Same answer again: a suspended account is still an account, and saying
    // so here would disclose both its existence and its state.
    audit('PASSWORD_RESET_REQUESTED', {
      actorUserId: user.user_id, entityType: 'email', entityId: email_id,
      details: { refused: 'suspended' },
    });
    return res.json(neutral);
  }

  const otp_code = String(Math.floor(100000 + Math.random() * 900000));
  const otp_expiry = new Date(Date.now() + OTP_TTL_MS).toISOString();

  db.prepare('UPDATE otps SET consumed = 1 WHERE identifier = ? AND consumed = 0').run(email_id);
  db.prepare(
    `INSERT INTO otps (identifier, identifier_type, otp_code, otp_expiry, purpose,
                       channel, destination, created_at)
     VALUES (?, 'EMAIL', ?, ?, 'RESET', 'EMAIL', ?, ?)`
  ).run(email_id, otp_code, otp_expiry, email_id, nowIso());

  await messaging.sendOtp({
    phoneNo: user.phone_no, otpCode: otp_code, channel: 'EMAIL', emailId: email_id,
  });
  audit('PASSWORD_RESET_REQUESTED', {
    actorUserId: user.user_id, entityType: 'user', entityId: user.user_id,
  });

  res.json({
    ...neutral,
    otp_expiry,
    ...(config.exposeOtp ? { otp_code, dev_note: 'otp_code is exposed because EXPOSE_OTP_IN_RESPONSE=true' } : {}),
  });
}));

/**
 * Sets a new password against a reset code.
 *
 * Every existing session is revoked. Somebody resetting a password has either
 * forgotten it or suspects it is known to someone else, and in the second case
 * leaving that someone else signed in would defeat the whole exercise. The
 * person doing the reset signs in again afterwards, which is a small price.
 */
router.post('/password/reset', otpVerifyLimiter, asyncRoute(async (req, res) => {
  const email_id = v.email(v.required(req.body.email_id, 'email_id'));
  const otp_code = String(v.required(req.body.otp_code, 'otp_code')).trim();

  const row = db.prepare(
    `SELECT * FROM otps WHERE identifier = ? AND consumed = 0 AND purpose = 'RESET'
     ORDER BY id DESC LIMIT 1`
  ).get(email_id);

  if (!row || row.otp_code !== otp_code) {
    return res.status(401).json({ error: 'Incorrect or expired reset code' });
  }
  if (new Date(row.otp_expiry).getTime() < Date.now()) {
    return res.status(401).json({ error: 'This reset code has expired' });
  }

  const user = findUserByEmail(email_id);
  if (!user) return res.status(401).json({ error: 'Incorrect or expired reset code' });

  // Checked before the code is consumed, so a password the rules refuse does
  // not cost somebody their one code and another round trip through email.
  const next = v.newPassword(req.body.new_password, 'new_password', {
    full_name: user.full_name, phone_no: user.phone_no, email_id: user.email_id,
  });

  db.prepare('UPDATE otps SET consumed = 1 WHERE id = ?').run(row.id);

  const now = nowIso();
  db.prepare('UPDATE users SET password_hash = ?, email_verified = 1, updated_at = ? WHERE user_id = ?')
    .run(bcrypt.hashSync(next, 12), now, user.user_id);

  const revoked = db.prepare(
    'UPDATE sessions SET revoked = 1, revoked_at = ? WHERE user_id = ? AND revoked = 0'
  ).run(now, user.user_id).changes;

  audit('PASSWORD_RESET', {
    actorUserId: user.user_id, entityType: 'user', entityId: user.user_id,
    details: { sessions_revoked: revoked },
  });

  res.json({
    message: 'Password reset. Sign in with your new password.',
    sessions_revoked: revoked,
  });
}));

module.exports = router;
