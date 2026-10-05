'use strict';
const crypto = require('node:crypto');
const { db } = require('../db');

// Identifier formats are fixed by the Data Dictionary (section 2):
//   user_id       'U'   + 8 digits   e.g. U00010023
//   provider_id   'P'   + 8 digits   e.g. P00004417
//   org_id        'O'   + 6 digits
//   booking_id    'BK'  + 8 digits   e.g. BK00031882
//   assignment_id 'AS'  + 8 digits
//   trip_id       'TR'  + 8 digits
//   invoice_id    'INV' + 8 digits
//   report_id     'RPT' + 6 digits
const FORMATS = {
  user: { prefix: 'U', width: 8 },
  provider: { prefix: 'P', width: 8 },
  org: { prefix: 'O', width: 6 },
  booking: { prefix: 'BK', width: 8 },
  assignment: { prefix: 'AS', width: 8 },
  trip: { prefix: 'TR', width: 8 },
  invoice: { prefix: 'INV', width: 8 },
  report: { prefix: 'RPT', width: 6 },
};

// A single counters table keeps every sequence monotonic and gap-free, which the
// audit requirement (C.5) relies on for reproducible identifiers.
function nextId(kind) {
  const fmt = FORMATS[kind];
  if (!fmt) throw new Error(`Unknown id kind: ${kind}`);
  db.prepare('INSERT OR IGNORE INTO id_counters(kind, value) VALUES (?, 0)').run(kind);
  db.prepare('UPDATE id_counters SET value = value + 1 WHERE kind = ?').run(kind);
  const row = db.prepare('SELECT value FROM id_counters WHERE kind = ?').get(kind);
  return fmt.prefix + String(row.value).padStart(fmt.width, '0');
}

/**
 * Identifier for one outbound alert (F.6, F.14).
 *
 * This is the primary key of `messages`, so a collision would abort the insert
 * and lose the delivery record for a dispatch alert. The timestamp prefix keeps
 * ids roughly sortable; the entropy comes from the random suffix, which is why
 * it is drawn from a CSPRNG rather than Math.random with four digits - four
 * digits collide about once in ten thousand messages sharing a millisecond.
 */
function messageId() {
  return 'MSG' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(8).toString('hex').toUpperCase();
}

module.exports = { nextId, messageId, FORMATS };
