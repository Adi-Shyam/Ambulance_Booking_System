'use strict';
// Shared setup for unit tests.
//
// Unit tests exercise one module in isolation. A few of those modules read
// reference data (fare_rules) or build SQL fragments, so each unit test file
// gets its own throwaway database rather than sharing one - a unit test must
// not be able to fail because of something another test did.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function useTempDatabase(label = 'unit') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `abs-${label}-`));
  process.env.DB_FILE = path.join(dir, `${label}.db`);
  return process.env.DB_FILE;
}

module.exports = { useTempDatabase };
