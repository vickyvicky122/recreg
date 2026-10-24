#!/usr/bin/env node
// measure.mjs: measures how well recreg's presets hide what they should.
//
// Usage:
//   node measure.mjs                          (test split, ./adapter.mjs, ./titles.csv)
//   node measure.mjs --split dev              (use while tuning keywords)
//   node measure.mjs --split test --out results.json
//
// Rule: tune keywords on the dev split only. Run the test split once at the end and
// report those numbers. Tuning on test makes the numbers look better than they are.

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
};
const split = opt('split', 'test');
const csvPath = opt('csv', 'titles.csv');
const adapterPath = opt('adapter', './adapter.mjs');
const outPath = opt('out', '');

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((v) => v !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows;
  return body.map((r) => Object.fromEntries(header.map((h, j) => [h, r[j] ?? ''])));
}

const pct = (a, b) => (b === 0 ? 'n/a' : `${Math.round((a / b) * 100)}%`);

const adapter = await import(pathToFileURL(resolve(adapterPath)).href);
const { presetIds, isHidden } = adapter;
if (!Array.isArray(presetIds) || typeof isHidden !== 'function') {
  console.error('adapter must export presetIds (array) and isHidden(title, presetId).');
  process.exit(1);
}

const all = parseCsv(readFileSync(csvPath, 'utf8'));
const rows = split === 'all' ? all : all.filter((r) => r.split === split);
if (!rows.length) { console.error(`No rows for split "${split}".`); process.exit(1); }

if (adapter.isStandIn) {
  console.warn('\n  WARNING: adapter.mjs is the STAND-IN matcher, not recreg\'s real code.');
  console.warn('  These numbers are for checking the script only. Do not publish them.\n');
}

const results = [];
for (const id of presetIds) {
  let tp = 0, fn = 0, fp = 0, tn = 0, easyPos = 0, easyCaught = 0, hardPos = 0, hardCaught = 0, traps = 0, trapsHidden = 0;
  const missed = [], wronglyHidden = [];
  for (const r of rows) {
    const should = r.category === id;
    const res = await isHidden(r.title, id);
    const hidden = typeof res === 'object' && res !== null ? Boolean(res.hidden) : Boolean(res);
    const matched = typeof res === 'object' && res !== null ? res.matched : undefined;
    if (should && hidden) tp++;
    else if (should && !hidden) { fn++; missed.push(r.title); }
    else if (!should && hidden) { fp++; wronglyHidden.push({ title: r.title, matched }); }
    else tn++;
    if (should && r.hard === 'yes') { hardPos++; if (hidden) hardCaught++; }
    if (should && r.hard !== 'yes') { easyPos++; if (hidden) easyCaught++; }
    if (r.trap_for === id) { traps++; if (hidden) trapsHidden++; }
  }
  results.push({
    id,
    caught: pct(tp, tp + fn),          // of titles that should be hidden, share hidden
    mistakes: pct(fp, fp + tn),        // of titles that should stay visible, share wrongly hidden
    precision: pct(tp, tp + fp),       // of titles hidden, share that should have been
    counts: { tp, fn, fp, tn, shouldHide: tp + fn, shouldStay: fp + tn },
    easyCaught: `${easyCaught}/${easyPos}`,
    hardCaught: `${hardCaught}/${hardPos}`,
    easyCounts: [easyCaught, easyPos],
    hardCounts: [hardCaught, hardPos],
    trapsWronglyHidden: `${trapsHidden}/${traps}`,
    missed,
    wronglyHidden,
  });
}

console.log(`recreg preset evaluation · split: ${split} · ${rows.length} titles\n`);
const pad = (s, n) => String(s).padEnd(n);
console.log(pad('preset', 12) + pad('caught', 16) + pad('mistakes', 16) + pad('precision', 12) + pad('easy caught', 14) + pad('hard caught', 13) + 'traps hidden');
for (const r of results) {
  const c = r.counts;
  console.log(
    pad(r.id, 12) +
    pad(`${r.caught} (${c.tp}/${c.shouldHide})`, 16) +
    pad(`${r.mistakes} (${c.fp}/${c.shouldStay})`, 16) +
    pad(r.precision, 12) +
    pad(r.easyCaught, 14) +
    pad(r.hardCaught, 13) +
    r.trapsWronglyHidden
  );
}
{
  const sum = (k) => results.reduce((a, r) => [a[0] + r[k][0], a[1] + r[k][1]], [0, 0]);
  const [ec, ep] = sum('easyCounts'), [hc, hp] = sum('hardCounts');
  console.log(`\nAll presets: easy titles caught ${ec}/${ep} (${pct(ec, ep)}) · hard titles caught ${hc}/${hp} (${pct(hc, hp)})`);
}
console.log('\nSmall samples: each preset has about 12 "should hide" titles per split, so one title moves the number by about 8 points.');

for (const r of results) {
  if (!r.missed.length && !r.wronglyHidden.length) continue;
  console.log(`\n${r.id}`);
  for (const t of r.missed) console.log(`  missed          ${t}`);
  for (const w of r.wronglyHidden) console.log(`  wrongly hidden  ${w.title}${w.matched ? `  (matched "${w.matched}")` : ''}`);
}

if (outPath) {
  writeFileSync(outPath, JSON.stringify({ split, titles: rows.length, standIn: Boolean(adapter.isStandIn), generatedAt: new Date().toISOString(), presets: results }, null, 2));
  console.log(`\nSaved ${outPath}`);
}
