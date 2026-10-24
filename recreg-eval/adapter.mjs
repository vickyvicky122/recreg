// adapter.mjs
// Connects measure.mjs to recreg's REAL filtering code: compileMatcher() from
// src/engine/matcher.ts and PRESETS from src/engine/presets.ts. Nothing is copied.
//
// Both are TypeScript, so they are bundled in memory with esbuild (already a
// devDependency) at load time. No files are written outside this folder, and
// the extension code is not modified.
//
// Preset terms are turned into rules the same way the app does it (see
// src/site/frontend-demo.ts and src/extension/options.ts): matchType defaults
// to "word", enabled: true. Titles are matched as-is; the extension also
// appends the channel name, which titles.csv does not have.

import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

export const isStandIn = false;

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

const bundled = await build({
  stdin: {
    contents: `export { compileMatcher } from './src/engine/matcher';
export { PRESETS } from './src/engine/presets';`,
    resolveDir: repoRoot,
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  logLevel: 'silent',
});
const code = bundled.outputFiles[0].text;
const { compileMatcher, PRESETS } = await import(
  'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
);

// titles.csv labels this category "news"; the real preset id is "distressing-news".
const CATEGORY_TO_PRESET = { news: 'distressing-news' };

export const presetIds = ['gambling', 'alcohol', 'shopping', 'news', 'phobias'];

const matchers = {};
for (const id of presetIds) {
  const preset = PRESETS.find((p) => p.id === (CATEGORY_TO_PRESET[id] ?? id));
  if (!preset) throw new Error(`No real preset for category "${id}"`);
  const rules = preset.terms.map((t, i) => ({
    id: `${preset.id}-${i}`,
    term: t.term,
    matchType: t.matchType ?? 'word',
    enabled: true,
    group: preset.id,
  }));
  matchers[id] = compileMatcher(rules);
}

// Returns { hidden, matched }.
export function isHidden(title, presetId) {
  const hit = matchers[presetId].match(title);
  return hit ? { hidden: true, matched: hit.term } : { hidden: false };
}
