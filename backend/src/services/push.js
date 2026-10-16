'use strict';
// F.14 - push notifications through Expo's push service.
//
// This is the only alert channel that reaches a phone whose app is closed,
// which makes it the one that matters for a dispatch offer: a driver waiting
// for work is not sitting with the console open on screen. The in-app inbox
// and the socket both assume someone is looking.
//
// Expo's endpoint needs no credentials for a project using Expo's own push
// service - the token itself is the address and the authorisation - so there
// is nothing to configure beyond the app registering its token. With
// EXPO_ACCESS_TOKEN set the request is authenticated, which Expo requires once
// push security is enabled for a project.
const config = require('../config');
const { db, nowIso } = require('../db');
const { messageId } = require('../utils/ids');

const EXPO_ENDPOINT = 'https://exp.host/--/api/v2/push/send';

// Expo accepts at most 100 messages per request.
const CHUNK = 100;

/** Stores or refreshes one device's token. */
function register(userId, { push_token, platform = null, device_name = null }) {
  const now = nowIso();
  db.prepare(
    `INSERT INTO push_tokens (user_id, push_token, platform, device_name, last_seen, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(push_token) DO UPDATE SET
       user_id = excluded.user_id,
       platform = excluded.platform,
       device_name = excluded.device_name,
       last_seen = excluded.last_seen`
  ).run(userId, push_token, platform, device_name, now, now);
}

/** Forgets one device, e.g. on sign-out. */
function forget(push_token) {
  db.prepare('DELETE FROM push_tokens WHERE push_token = ?').run(push_token);
}

const tokensFor = (userId) =>
  db.prepare('SELECT push_token FROM push_tokens WHERE user_id = ?').all(userId).map((r) => r.push_token);

/** Logs the attempt beside every other channel, so the alert log stays one list. */
function record({ userId, body, title, bookingId, deliveryState, providerResponse, tokenCount }) {
  // `recipient_phone` is nullable, so an account without a number still gets a
  // row. Dropping the row instead would hide a sent alert from the control
  // room's log, which is the one place that is meant to show everything.
  const phone = db.prepare('SELECT phone_no FROM users WHERE user_id = ?').get(userId)?.phone_no || null;
  const id = messageId();
  db.prepare(
    `INSERT INTO messages (message_id, booking_id, recipient_phone, message_channel,
                           message_template_id, body, delivery_state, delivery_timestamp,
                           provider_response, created_at)
     VALUES (?, ?, ?, 'PUSH', ?, ?, ?, ?, ?, ?)`
  ).run(
    id, bookingId || null, phone, 'expo_push', `${title}\n${body || ''}`.trim(),
    deliveryState, nowIso(),
    JSON.stringify({ devices: tokenCount, ...providerResponse }).slice(0, 2000), nowIso()
  );

  // Push belongs in the same log as every other channel, and arrives there
  // the same way. See messaging.announce for why this is required at call
  // time rather than at the top of the file.
  try {
    require('../realtime/socket').toAdmins('admin:message', {
      message_id: id, booking_id: bookingId || null, recipient_phone: phone,
      recipient_email: null, message_channel: 'PUSH', message_template_id: 'expo_push',
      body: `${title}
${body || ''}`.trim(), delivery_state: deliveryState,
      created_at: nowIso(),
    });
  } catch {
    // No socket server yet.
  }

  return id;
}

/**
 * Sends one notification to every device a user has registered.
 *
 * Resolves rather than rejects, and is never awaited by the dispatch path: a
 * push outage must not stop an ambulance being assigned (NF.1). A device whose
 * token Expo reports as dead is dropped, so a reinstalled app does not leave a
 * token behind that fails forever.
 */
async function send(userId, { title, body, data = {}, priority = 'default', bookingId = null }) {
  const tokens = tokensFor(userId);
  if (tokens.length === 0) return null;

  if (config.push.mock) {
    console.log(`
[push:mock -> ${tokens.length} device(s)] ${title}
${body || ''}
`);
    return record({
      userId, title, body, bookingId, tokenCount: tokens.length,
      deliveryState: 'SENT', providerResponse: { transport: 'mock' },
    });
  }

  const messages = tokens.map((to) => ({
    to,
    title,
    body: body || undefined,
    data,
    sound: priority === 'high' ? 'default' : null,
    priority,
    // Android shows this as a heads-up notification rather than only in the
    // tray, which is the difference between a driver noticing a 45-second
    // offer and missing it.
    channelId: priority === 'high' ? 'dispatch' : 'default',
  }));

  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (config.push.accessToken) headers.Authorization = `Bearer ${config.push.accessToken}`;

  try {
    const receipts = [];
    for (let i = 0; i < messages.length; i += CHUNK) {
      const res = await fetch(EXPO_ENDPOINT, {
        method: 'POST',
        headers,
        body: JSON.stringify(messages.slice(i, i + CHUNK)),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.errors?.[0]?.message || `Expo push returned ${res.status}`);
      receipts.push(...(json.data || []));
    }

    // Expo reports a per-message status; DeviceNotRegistered means the app was
    // uninstalled or the token rotated, and that token will never work again.
    receipts.forEach((r, i) => {
      if (r?.status === 'error' && r?.details?.error === 'DeviceNotRegistered') {
        forget(messages[i].to);
        console.log('[push] dropped a token Expo no longer recognises');
      }
    });

    const failed = receipts.filter((r) => r?.status === 'error').length;
    return record({
      userId, title, body, bookingId, tokenCount: tokens.length,
      deliveryState: failed === receipts.length && receipts.length > 0 ? 'FAILED' : 'SENT',
      providerResponse: { receipts: receipts.slice(0, 10) },
    });
  } catch (err) {
    console.error('[push] send failed:', err.message);
    return record({
      userId, title, body, bookingId, tokenCount: tokens.length,
      deliveryState: 'FAILED', providerResponse: { error: err.message },
    });
  }
}

module.exports = { register, forget, send, tokensFor };
