'use strict';
// F.14 - one place that writes the in-app notification row and pushes it over
// the socket, so every lifecycle event reaches the right party exactly once.
const { db, nowIso } = require('../db');
const sockets = require('../realtime/socket');

function notify(userId, { title, body, eventType, bookingId = null }) {
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
