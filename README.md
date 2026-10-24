# recreg — recommendation regulation

A browser extension that gives you control over recommended content on
YouTube, Reddit and Pinterest, plus a landing site with a live demo.
You define what you want to avoid; recreg cross-checks every recommendation
card against your rules — locally, on your device — and hides matches before
you see them.

**Core principle:** interacting with content is not consent to future
recommendations.

**Security model:** no servers, no accounts, no telemetry, and the extension
requests **zero network access** — exfiltration is structurally impossible,
not just policy. See [ARCHITECTURE.md](ARCHITECTURE.md) for the full threat
model and design.

## Quick start

```sh
npm install
npm run verify        # security gate → typecheck → tests → build
```

### Load the extension (Chrome / Edge / Brave / Arc)

1. `npm run build:ext` (output lands in `extension/dist/`)
2. Open `chrome://extensions`, enable **Developer mode**
3. **Load unpacked** → select `extension/dist/`
4. Open the extension's **settings** (puzzle icon → recreg → Options)
5. Enable the sites you want — the browser asks for each site's permission
   individually — then add filters or apply a preset
6. Reload any already-open tabs for those sites

The toolbar badge shows how many recommendations are hidden on the current
page. The popup gives you pause, quick-add, and per-page status.

### Run / deploy the website

```sh
npm run build:site    # output lands in site/dist/
npx serve site/dist   # local preview
```

Deploy to Vercel: import the repo at vercel.com (or run `npx vercel`).
`vercel.json` already sets the build command, output directory, and strict
security headers (CSP with `connect-src 'none'` — the site makes no network
calls either). The demo on the page runs the exact engine the extension
ships.

## Project layout

```
src/engine/       pure matching engine + preference schema (no DOM, no I/O)
src/adapters/     per-site selector definitions — data, not code
src/extension/    MV3 extension: service worker, content script, popup, options
src/site/         landing-page demo script (reuses the engine)
site/             landing page HTML/CSS (Vercel root)
tests/            engine, preference-validation, and adapter tests
scripts/          security gate (forbids fetch/innerHTML/eval in src/)
build.mjs         esbuild bundling + icon generation
```

## npm scripts

| Script | What it does |
|---|---|
| `npm run verify` | security check → typecheck → tests → full build |
| `npm run build` | build extension and site |
| `npm run build:ext` / `build:site` | build one target |
| `npm test` | engine/prefs/adapter unit tests |
| `npm run check:security` | fail if network calls, HTML sinks, or dynamic code appear in `src/` |

## How filtering works

1. The content script (registered per-site, only after you grant that site)
   watches the page with a `MutationObserver`.
2. For each recommendation card, it reads visible text (title, author,
   aria-labels) using the site adapter's selectors.
3. The engine matches that text against your rules (whole-word, phrase, or
   substring; Unicode-aware; terms are always literals, never regex).
4. Matches are covered with a neutral placeholder (revealable per item) or
   removed, per your settings. A suppression stylesheet keeps cards invisible
   until they've been checked, so nothing flashes before filtering.
5. Deliberate searches pass through — adapters only cover recommendation
   regions, not search results.

If a site redesign breaks an adapter, the health check flips the popup/badge
to a visible "degraded" state instead of silently showing an unfiltered feed.

## Known limitations

- **Selector drift:** YouTube/Reddit/Pinterest change their DOM regularly.
  Adapters in `src/adapters/index.ts` carry fallbacks for recent DOM
  generations but need periodic validation against the live sites.
- **Word matching is literal:** a rule for `bet` does not match `bets` —
  presets include common inflections; add your own as needed.
- **Text only:** image-only content with no text/alt labels can't be matched
  yet (per the MVP spec).
- **Instagram** is not in the MVP: its obfuscated, fast-changing DOM makes a
  reliable adapter a project of its own.

## Roadmap

- Signed remote adapter updates (survive site redesigns without store review
  latency) — the only network feature the extension should ever gain
- Firefox build (same WebExtensions codebase, minor manifest differences)
- On-device semantic matching on top of keyword rules
- More sites: X/Twitter, TikTok web, news aggregators
