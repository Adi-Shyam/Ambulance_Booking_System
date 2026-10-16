'use strict';
// Persistence layer. Uses node:sqlite (built into Node 22.5+) so the project has
// no native build step - important for a lab machine where a compiler toolchain
// may not be installed. The SQL itself is plain relational SQL, so the schema
// ports to PostgreSQL/MySQL with only the AUTOINCREMENT keyword changed.
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, 'ambulance.db');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(DB_FILE);

function migrate() {
  // Order matters. Table rebuilds come first because schema.sql declares
  // indexes over the new shape - an index on `otps(identifier)` cannot be
  // created while the table still has the old `phone_no` column, and
  // CREATE TABLE IF NOT EXISTS would have left that table untouched. Each
  // rebuild reads its DDL from schema.sql, not from the database, so running
  // them before the replay is safe; on a fresh database they find no tables
  // and do nothing.
  widenCheckConstraints();
  db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  addMissingColumns();
  seedFareRules();
}

// `CREATE TABLE IF NOT EXISTS` leaves an existing table untouched, so columns
// added after a database was first created have to be applied separately.
// Each entry is idempotent: it runs only when the column is absent.
const COLUMN_ADDITIONS = [
  ['users', 'email_verified', 'INTEGER NOT NULL DEFAULT 0'],
  ['users', 'phone_verified', 'INTEGER NOT NULL DEFAULT 0'],
  ['trips', 'distance_travelled_km', 'REAL NOT NULL DEFAULT 0'],
  ['trips', 'laden_distance_km', 'REAL NOT NULL DEFAULT 0'],
  ['bookings', 'stall_flagged_at', 'TEXT'],
  ['sessions', 'token_id', 'TEXT'],
  ['sessions', 'role_code', 'TEXT'],
  ['sessions', 'revoked_at', 'TEXT'],
  ['messages', 'recipient_email', 'TEXT'],
  ['otps', 'channel', "TEXT NOT NULL DEFAULT 'WHATSAPP'"],
  ['otps', 'destination', 'TEXT'],
];

// A CHECK constraint cannot be altered in place, so widening one means
// rebuilding the table and copying the rows across. Each entry is guarded on
// the DDL SQLite has stored, so it runs once and is a no-op afterwards -
// including on a database created fresh from schema.sql, which already has the
// wider constraint.
//
// `otps.channel` is not here: adding a column *with* a CHECK is allowed, so
// COLUMN_ADDITIONS handles that one.
function widenCheckConstraints() {
  // `otps.phone_no` became `identifier`: a code proves control of one contact
  // detail, and since registration now verifies an email address, the row can
  // no longer be keyed on a phone number it may not have. Rows already in the
  // table were all phone codes, so they carry over as identifier_type 'PHONE'.
  rebuildTable({
    table: 'otps',
    needsRebuild: (ddl) => !ddl.includes('identifier'),
    createSql: ddlFromSchema('otps', 'otps_migrated'),
    indexes: ['CREATE INDEX IF NOT EXISTS idx_otps_identifier ON otps(identifier, consumed)'],
    carry: { identifier: 'phone_no', identifier_type: "'PHONE'" },
  });

  // email_id gained UNIQUE when an address became something you sign in with.
  rebuildTable({
    table: 'users',
    needsRebuild: (ddl) => !/email_id\s+TEXT UNIQUE/.test(ddl),
    createSql: ddlFromSchema('users', 'users_migrated'),
    indexes: ['CREATE INDEX IF NOT EXISTS idx_users_role ON users(role_code)'],
  });

  // EMG joined the request types when emergency dispatch arrived. It is a
  // request, not a vehicle class, so `providers.ambulance_type` is untouched:
  // an emergency is served by whatever is nearest, whatever it is.
  rebuildTable({
    table: 'bookings',
    needsRebuild: (ddl) => ddl.includes("ambulance_type IN ('BLS','ALS','ICU','PTV')"),
    createSql: ddlFromSchema('bookings', 'bookings_migrated'),
    indexes: [
      'CREATE INDEX IF NOT EXISTS idx_bookings_user ON bookings(user_id, booking_timestamp DESC)',
      'CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(booking_status)',
    ],
  });

  rebuildTable({
    table: 'fare_rules',
    needsRebuild: (ddl) => ddl.includes("ambulance_type IN ('BLS','ALS','ICU','PTV')"),
    createSql: ddlFromSchema('fare_rules', 'fare_rules_migrated'),
  });

  // EMAIL joined WHATSAPP/PUSH/SMS when verification codes gained an email
  // channel (F.1). Databases created before that reject the insert outright.
  rebuildTable({
    table: 'messages',
    needsRebuild: (ddl) =>
      !ddl.includes("'EMAIL'") || /recipient_phone\s+TEXT NOT NULL/.test(ddl),
    createSql: ddlFromSchema('messages', 'messages_migrated'),
    indexes: ['CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at DESC)'],
  });
}

/**
 * Lifts one `CREATE TABLE` statement out of schema.sql and renames it.
 *
 * A rebuild has to state the shape it is building, and writing that shape out
 * a second time here is how the two drift apart: widen a constraint in
 * schema.sql, forget to widen the copy, and a database that rebuilds ends up
 * with neither the old shape nor the new one. Reading the declaration back
 * means there is only ever one.
 */
function ddlFromSchema(table, newName) {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  const head = `CREATE TABLE IF NOT EXISTS ${table} (`;
  const from = schema.indexOf(head);
  if (from === -1) throw new Error(`ddlFromSchema: no CREATE TABLE for ${table} in schema.sql`);

  // Every table in this file closes with `);` at the start of a line, so the
  // first such sequence after the header ends this statement.
  const bodyStart = from + head.length;
  const to = schema.indexOf('\n);', bodyStart);
  if (to === -1) throw new Error(`ddlFromSchema: ${table} is not closed by ");" in schema.sql`);

  return `CREATE TABLE ${newName} (${schema.slice(bodyStart, to)}\n)`;
}

/**
 * Replaces `table` with `createSql`, carrying over every column the two shapes
 * share. Columns new to the rebuilt table keep their default, which is how
 * `recipient_email` arrives populated with NULL rather than failing the copy.
 *
 * This is SQLite's documented procedure for altering a table, and the order
 * matters. Foreign keys are suspended for the duration, because dropping
 * `bookings` while `assignments`, `trips`, `invoices`, `messages` and
 * `notifications` all reference it is a violation however briefly it holds;
 * the pragma cannot be changed inside a transaction, so it goes outside.
 * `legacy_alter_table` stops the rename rewriting other tables' references to
 * point at the temporary name.
 *
 * `foreign_key_check` then runs *before* the commit, so a rebuild that would
 * have orphaned a row rolls back with the old table still in place rather than
 * leaving the database half-migrated.
 */
function rebuildTable({ table, needsRebuild, createSql, indexes = [], carry = {} }) {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
  if (!row || !needsRebuild(row.sql)) return;

  const before = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
  const fkWasOn = db.prepare('PRAGMA foreign_keys').get().foreign_keys === 1;

  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('PRAGMA legacy_alter_table = ON');
  db.exec('BEGIN');
  try {
    db.exec(`DROP TABLE IF EXISTS ${table}_migrated`);
    db.exec(createSql);

    // Intersect the two column lists so the copy does not name a column that
    // only one side has, in either direction.
    const oldCols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    const newCols = db.prepare(`PRAGMA table_info(${table}_migrated)`).all().map((c) => c.name);
    const shared = oldCols.filter((c) => newCols.includes(c));

    // `carry` fills a column the old shape does not have under that name -
    // a rename, or a constant for rows that predate the distinction. Without
    // it a renamed NOT NULL column would fail the copy.
    const targets = [...shared, ...Object.keys(carry).filter((c) => newCols.includes(c) && !shared.includes(c))];
    const sources = targets.map((c) => (shared.includes(c) ? c : carry[c]));

    db.exec(
      `INSERT INTO ${table}_migrated (${targets.join(', ')})
       SELECT ${sources.join(', ')} FROM ${table}`
    );
    db.exec(`DROP TABLE ${table}`);
    db.exec(`ALTER TABLE ${table}_migrated RENAME TO ${table}`);
    for (const sql of indexes) db.exec(sql);

    const orphans = db.prepare('PRAGMA foreign_key_check').all();
    if (orphans.length) {
      throw new Error(
        `rebuilding ${table} would orphan ${orphans.length} row(s), e.g. in ${orphans[0].table}`
      );
    }

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    db.exec('PRAGMA legacy_alter_table = OFF');
    if (fkWasOn) db.exec('PRAGMA foreign_keys = ON');
  }

  const after = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
  console.log(`[db] rebuilt ${table} to widen a CHECK constraint (${after}/${before} rows carried over)`);
}

function addMissingColumns() {
  for (const [table, column, definition] of COLUMN_ADDITIONS) {
    const existing = db.prepare(`PRAGMA table_info(${table})`).all();
    if (existing.length === 0) continue;
    if (existing.some((c) => c.name === column)) continue;
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    console.log(`[db] added ${table}.${column}`);
  }
}

// Fare rules back F.10 (fare depends on distance and ambulance_type).
function seedFareRules() {
  const rows = [
    ['BLS', 500, 22, 0, 'Basic Life Support', 'Oxygen, stretcher and a trained attendant'],
    ['ALS', 900, 30, 400, 'Advanced Life Support', 'Ventilator, defibrillator and paramedic'],
    ['ICU', 1500, 40, 900, 'Mobile ICU', 'Critical-care setup with monitoring equipment'],
    ['PTV', 350, 16, 0, 'Patient Transport', 'Non-emergency transfer between facilities'],
    // Priced for priority dispatch rather than for a vehicle class, because an
    // emergency request is served by whatever is nearest. Billing instead at
    // the responding vehicle's rate would be the production refinement.
    ['EMG', 800, 28, 300, 'Emergency', 'Nearest available ambulance, alerted all at once'],
  ];
  const stmt = db.prepare(
    `INSERT INTO fare_rules (ambulance_type, base_fare, per_km_rate, type_surcharge, label, description)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(ambulance_type) DO UPDATE SET
       base_fare = excluded.base_fare,
       per_km_rate = excluded.per_km_rate,
       type_surcharge = excluded.type_surcharge,
       label = excluded.label,
       description = excluded.description`
  );
  for (const r of rows) stmt.run(...r);
}

/** Runs a set of statements atomically. */
function transaction(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

const nowIso = () => new Date().toISOString();

/** Appends an audit record (constraint C.5). Never throws into the caller. */
function audit(action, { actorUserId = null, actorRole = null, entityType = null, entityId = null, details = null } = {}) {
  const created_at = nowIso();
  try {
    const info = db.prepare(
      `INSERT INTO audit_log (actor_user_id, actor_role, action, entity_type, entity_id, details, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      actorUserId,
      actorRole,
      action,
      entityType,
      entityId,
      details ? JSON.stringify(details) : null,
      created_at
    );

    // The control room's audit trail is meant to be watched, not refreshed.
    // Required here rather than at the top of the file because the socket
    // layer requires this module: taking it at call time breaks the cycle,
    // and before a server exists there is simply nothing to emit to.
    try {
      require('../realtime/socket').toAdmins('admin:audit', {
        id: Number(info.lastInsertRowid),
        actor_user_id: actorUserId,
        actor_role: actorRole,
        action,
        entity_type: entityType,
        entity_id: entityId,
        details: details ? JSON.stringify(details) : null,
        created_at,
      });
    } catch {
      // No socket server yet - a seed run, or a test touching the database
      // directly. The row is written either way, which is what matters.
    }
  } catch (err) {
    console.error('[audit] failed to record entry:', err.message);
  }
}

module.exports = { db, migrate, transaction, audit, nowIso, DB_FILE };
