'use strict';
// Produces docs/TEST_RESULTS.md from an actual test run.
//
// The testing phase needs evidence, not a hand-written table that can drift
// from the code. This runs the suite, parses the TAP output and writes the
// result. Run with: npm run test:report
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const LEVELS = [
  { name: 'Unit', glob: 'tests/unit/*.test.js', purpose: 'One module in isolation' },
  { name: 'Integration', glob: 'tests/integration/*.test.js', purpose: 'Modules working together over HTTP and the database' },
  { name: 'System', glob: 'tests/system/*.test.js', purpose: 'Whole-system behaviour and failure recovery' },
];

function runLevel(glob) {
  const started = Date.now();
  const proc = spawnSync(
    process.execPath,
    ['--test', '--test-reporter=tap', glob],
    { encoding: 'utf8', cwd: path.join(__dirname, '..'), maxBuffer: 32 * 1024 * 1024 }
  );

  const out = `${proc.stdout || ''}\n${proc.stderr || ''}`;
  const number = (key) => {
    const m = out.match(new RegExp(`^# ${key} (\\d+)$`, 'm'));
    return m ? Number(m[1]) : 0;
  };

  // Leaf assertions only: TAP lines with no nested indentation.
  const cases = [];
  for (const line of out.split('\n')) {
    const m = line.match(/^(?:ok|not ok) \d+ - (.+?)(?: # .*)?$/);
    if (m && !/^Subtest/.test(m[1])) {
      cases.push({ name: m[1].trim(), passed: line.startsWith('ok') });
    }
  }

  return {
    pass: number('pass'),
    fail: number('fail'),
    total: number('tests'),
    skipped: number('skipped'),
    durationMs: Date.now() - started,
    cases,
    exitCode: proc.status,
  };
}

function main() {
  console.log('Running the suite by level…\n');
  const results = LEVELS.map((level) => {
    process.stdout.write(`  ${level.name.padEnd(12)}`);
    const r = runLevel(level.glob);
    console.log(`${r.pass}/${r.total} passed  (${(r.durationMs / 1000).toFixed(1)}s)`);
    return { ...level, ...r };
  });

  const totals = results.reduce(
    (acc, r) => ({ pass: acc.pass + r.pass, fail: acc.fail + r.fail, total: acc.total + r.total }),
    { pass: 0, fail: 0, total: 0 }
  );

  const stamp = new Date().toISOString();
  const lines = [
    '# Test results',
    '',
    'Ambulance Booking System — Team 16, IT303.',
    '',
    `Generated from an actual run by \`npm run test:report\` on ${stamp}.`,
    'Do not edit by hand; re-run the command instead.',
    '',
    '## Summary',
    '',
    '| Level | Purpose | Tests | Passed | Failed |',
    '|---|---|---|---|---|',
    ...results.map((r) => `| ${r.name} | ${r.purpose} | ${r.total} | ${r.pass} | ${r.fail} |`),
    `| **Total** | | **${totals.total}** | **${totals.pass}** | **${totals.fail}** |`,
    '',
    totals.fail === 0
      ? `All ${totals.total} tests passed.`
      : `**${totals.fail} test(s) failed** — see the detail below.`,
    '',
  ];

  for (const r of results) {
    lines.push(`## ${r.name} tests`, '', '| # | Test case | Result |', '|---|---|---|');
    r.cases.forEach((c, i) => {
      lines.push(`| ${i + 1} | ${c.name.replace(/\|/g, '\\|')} | ${c.passed ? 'Pass' : '**Fail**'} |`);
    });
    lines.push('');
  }

  const outPath = path.join(__dirname, '..', '..', 'docs', 'TEST_RESULTS.md');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, lines.join('\n'));

  console.log(`\n  ${totals.pass}/${totals.total} passed, ${totals.fail} failed`);
  console.log(`  written to ${outPath}\n`);
  process.exit(totals.fail === 0 ? 0 : 1);
}

main();
