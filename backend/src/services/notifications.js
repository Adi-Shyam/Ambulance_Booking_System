'use strict';
// F.14 - one place that writes the in-app notification row and pushes it over
// the socket, so every lifecycle event reaches the right party exactly once.
const { db, nowIso } = require('../db');
const sockets = require('../realtime/socket');
const push = require('./push');

/**
 * Writes the inbox row, pushes it over the socket, and - when the caller asks
 * for one - sends a real push notification as well.
 *
 * `push` is opt-in per call rather than automatic. Every lifecycle event
 * deserves an inbox row; only some deserve to light up a phone that is in
 * someone's pocket. A dispatch offer does, a fare settling does not.
 *
 * The push is deliberately not awaited: Expo being slow or down must not hold
 * up a dispatch (NF.1).
 */
function notify(userId, { title, body, eventType, bookingId = null, push: pushOpts = null }) {
  const createdAt = nowIso();
  const info = db.prepare(
    `INSERT INTO notifications (user_id, booking_id, title, body, event_type, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(userId, bookingId, title, body || null, eventType || null, createdAt);

  const payload = {
    id: Number(info.lastInsertRowid),
    user_id: userId,
    booking_id: bookingId,
    title,
    body: body || null,
    event_type: eventType || null,
    read_flag: 0,
    created_at: createdAt,
  };
  sockets.toUser(userId, 'notification', payload);

  if (pushOpts) {
    push
      .send(userId, {
        title,
        body,
        bookingId,
        priority: pushOpts.priority || 'default',
        data: { ...(pushOpts.data || {}), event_type: eventType || null },
      })
      .catch((err) => console.error('[notify] push failed:', err.message));
  }

  return payload;
}

function list(userId, limit = 50) {
  return db.prepare(
    'SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT ?'
  ).all(userId, limit);
}

function markRead(userId, ids) {
  if (!Array.isArray(ids) || ids.length === 0) {
    db.prepare('UPDATE notifications SET read_flag = 1 WHERE user_id = ?').run(userId);
    return;
  }
  const stmt = db.prepare('UPDATE notifications SET read_flag = 1 WHERE user_id = ? AND id = ?');
  for (const id of ids) stmt.run(userId, Number(id));
}

function unreadCount(userId) {
  const row = db.prepare(
    'SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read_flag = 0'
  ).get(userId);
  return row.c;
}

module.exports = { notify, list, markRead, unreadCount };
