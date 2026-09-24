#!/usr/bin/env node
/* Runs the test suite, collects story ids ([3.1.4]) from PASSING test names, and marks the checklists.
   Usage: node scripts/checklist-status.js [--write] [--force] [--json]   (without --write: report only)

   Evidence rules — a story counts as covered only when ALL of these hold:
   1. a test whose name carries its id reported `ok`;
   2. that line carried no TAP directive (`# SKIP` / `# TODO` are not evidence);
   3. the file that declares the id did not itself fail. node reports a file-level failure as
      `not ok N - /abs/path/x.test.js`, a line with no id in it — a failing `after` hook or an async
      error escaping after the tests reported would otherwise leave the stories green in a red file.
   `--write` refuses to tick anything when the run did not exit cleanly, unless `--force` is given.
   `--json` prints the same verdict as one machine-readable object (run summary, per-section counts and
   every story without evidence, with the reason) and nothing else, so CI can read it. */
'use strict';
const { spawnSync } = require('node:child_process'); const fs = require('node:fs'); const path = require('node:path');
/* Listy kontrolne leżą w katalogu demo (school-management-demo/checklist*.md), nie w korzeniu
   repozytorium — po przeniesieniu prototypu do edmat (881d80d) ścieżka o poziom za daleko sprawiała,
   że narzędzie kończyło się ENOENT. */
const root = path.join(__dirname, '..');
const testsDir = path.join(__dirname, '..', 'tests');
const ID_RE = /\[(3\.\d+\.\d+)\]/g;

/** id -> file that declares it, and file -> ids, read from the test sources. */
const idsOfFile = new Map(); const fileOfId = new Map();
for (const f of fs.readdirSync(testsDir).filter((x) => x.endsWith('.test.js'))) {
  const src = fs.readFileSync(path.join(testsDir, f), 'utf8');
  const ids = new Set((src.match(ID_RE) || []).map((t) => t.slice(1, -1)));
  idsOfFile.set(f, ids); for (const id of ids) fileOfId.set(id, f);
}

const res = spawnSync(process.execPath, ['--test', '--test-reporter=tap', testsDir], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const out = res.stdout + res.stderr;

const passing = new Set(); const rejected = new Map();           // id -> why it is not evidence
const reject = (id, why) => { passing.delete(id); if (!rejected.has(id)) rejected.set(id, why); };

for (const line of out.split('\n')) {
  const m = /^\s*(not ok|ok) \d+ - (.*)$/.exec(line); if (!m) continue;
  const ok = m[1] === 'ok';
  const dm = /\s#\s(SKIP|TODO)\b\s*(.*)$/i.exec(m[2]);
  const name = dm ? m[2].slice(0, dm.index) : m[2];
  const directive = dm ? dm[1].toUpperCase() : null;

  // File-level line: the name is the test file's path and carries no story id of its own.
  const ids = [...name.matchAll(ID_RE)].map((t) => t[1]);
  const fm = /([^/\\]+\.test\.js)\s*$/.exec(name.trim());
  if (!ids.length && fm && idsOfFile.has(fm[1])) {
    if (!ok) for (const id of idsOfFile.get(fm[1])) reject(id, `plik ${fm[1]} zakończył się błędem (not ok na poziomie pliku)`);
    continue;
  }
  for (const id of ids) {
    if (directive) reject(id, `test oznaczony jako ${directive}${dm[2] ? ': ' + dm[2].trim() : ''}`);
    else if (!ok) reject(id, 'test nie przeszedł');
    else if (!rejected.has(id)) passing.add(id);
  }
}
for (const id of rejected.keys()) passing.delete(id);

const clean = res.status === 0;
const write = process.argv.includes('--write');
if (write && !clean && !process.argv.includes('--force')) {
  console.error('Przerwano: `node --test` zakończył się kodem ' + res.status + ' — nie odhaczam listy z niepełnego przebiegu. Użyj --force, jeśli naprawdę tego chcesz.');
}
const mayWrite = write && (clean || process.argv.includes('--force'));

function mark(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n'); let section = null, n = 0, total = 0, done = 0; const missing = []; const sections = [];
  const why = (idv) => rejected.get(idv) || (fileOfId.has(idv) ? 'brak wyniku w przebiegu' : 'brak testu z tym numerem');
  const outLines = lines.map((l) => {
    const hm = /^## (3\.\d+)\b/.exec(l); if (hm) { section = hm[1]; n = 0; sections.push({ id: section, title: l.replace(/^##\s*/, ''), total: 0, done: 0, open: [] }); return l; }
    const im = /^- \[( |x)\] (.*)$/.exec(l); if (!im || !section) return l;
    const sec = sections[sections.length - 1];
    n++; total++; sec.total++; const idv = `${section}.${n}`; const ok = passing.has(idv); if (ok) { done++; sec.done++; }
    else { missing.push({ id: idv, reason: why(idv), story: im[2], file: fileOfId.get(idv) || null }); sec.open.push(idv); }
    return `- [${ok ? 'x' : ' '}] ${im[2]}`;
  });
  if (mayWrite) fs.writeFileSync(file, outLines.join('\n'));
  return { total, done, missing, sections };
}
const en = mark(path.join(root, 'checklist.md')); const pl = mark(path.join(root, 'checklist_pl.md'));
const num = (re) => { const m = out.match(re); return m ? +m[1] : null; };
const run = { pass: num(/^# pass (\d+)/m), fail: num(/^# fail (\d+)/m), skipped: num(/^# skipped (\d+)/m), todo: num(/^# todo (\d+)/m), exit: res.status, clean };

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(), run, written: mayWrite,
    stories: { total: en.total, covered: en.done, open: en.missing.length, totalPl: pl.total, coveredPl: pl.done },
    sections: en.sections.map((x) => ({ id: x.id, title: x.title, total: x.total, covered: x.done, open: x.open })),
    withoutEvidence: en.missing,
  }, null, 2));
  process.exit(clean ? 0 : 1);
}

console.log(`Tests: ${run.pass ?? '?'} passed, ${run.fail ?? '?'} failed, ${run.skipped ?? '?'} skipped, ${run.todo ?? '?'} todo (exit ${res.status}).`);
console.log(`Stories with passing evidence: ${en.done}/${en.total} (PL ${pl.done}/${pl.total}).`);
const bar = (d, t) => '█'.repeat(Math.round((d / t) * 10)) + '·'.repeat(10 - Math.round((d / t) * 10));
console.log('Per section:');
for (const x of en.sections) console.log(`  ${x.id.padEnd(5)} ${String(x.done).padStart(3)}/${String(x.total).padEnd(3)} ${bar(x.done, x.total)}  ${x.title.slice(0, 48)}${x.open.length ? '  · otwarte: ' + x.open.join(', ') : ''}`);
if (!clean) console.log('Uwaga: przebieg nie był czysty — powyższa liczba pochodzi z przebiegu z błędami.');
if (en.missing.length) { console.log('Bez dowodu w testach:'); en.missing.forEach((m) => console.log(`  ${m.id} — ${m.reason}${m.file ? ' (' + m.file + ')' : ''} · ${m.story.slice(0, 60)}`)); }
else console.log('Każda historyjka ma dowód w zielonym teście.');
process.exit(clean ? 0 : 1);
