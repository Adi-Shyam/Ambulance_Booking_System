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
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);
  addMissingColumns();
  seedFareRules();
}

// `CREATE TABLE IF NOT EXISTS` leaves an existing table untouched, so columns
// added after a database was first created have to be applied separately.
// Each entry is idempotent: it runs only when the column is absent.
const COLUMN_ADDITIONS = [
  ['trips', 'distance_travelled_km', 'REAL NOT NULL DEFAULT 0'],
  ['trips', 'laden_distance_km', 'REAL NOT NULL DEFAULT 0'],
  ['bookings', 'stall_flagged_at', 'TEXT'],
  ['sessions', 'token_id', 'TEXT'],
  ['sessions', 'role_code', 'TEXT'],
  ['sessions', 'revoked_at', 'TEXT'],
];

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
  try {
    db.prepare(
      `INSERT INTO audit_log (actor_user_id, actor_role, action, entity_type, entity_id, details, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      actorUserId,
      actorRole,
      action,
      entityType,
      entityId,
      details ? JSON.stringify(details) : null,
      nowIso()
    );
  } catch (err) {
    console.error('[audit] failed to record entry:', err.message);
  }
}

module.exports = { db, migrate, transaction, audit, nowIso, DB_FILE };
