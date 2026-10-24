# recreg — Secure Architecture

recreg is a browser extension that filters recommended content across sites
(YouTube, Pinterest, Instagram, news feeds) according to boundaries the user
defines. This document describes the architecture for the MVP and the security
reasoning behind each decision.

## 1. Threat model

### What we protect

1. **The filter list.** A user's exclusion terms are sensitive personal data:
   they can reveal phobias, addictions (gambling, alcohol), mental-health
   triggers, political views, or ongoing life events. The filter list is the
   crown jewel — more sensitive than browsing history in some ways, because it
   is explicit and curated.
2. **Page content the extension can read.** To filter recommendations, the
   extension must read the DOM of logged-in sessions on major platforms. That
   read access must never become write/exfiltrate access.
3. **The user's purpose.** For someone avoiding distressing content, a filter
   that silently fails (or flashes content before hiding it) is a harm, not
   just a bug. Reliability and fail-visible behavior are security properties
   here.

### Threats considered

| Threat | Mitigation (summary) |
|---|---|
| Exfiltration of filter terms or browsing data | **No network capability at all** in the MVP — structurally impossible, not policy |
| Supply-chain compromise (deps, build, remote config) | Near-zero runtime dependencies, no remote code/config, pinned lockfile, reproducible build |
| Malicious/compromised page content reaching extension privileges | Isolated-world content scripts, all page data treated as untrusted text, no `innerHTML`, strict message validation |
| Other extensions or websites messaging us | No `externally_connectable`, sender verification on every message |
| Over-broad permissions (store trust, blast radius) | Per-site `optional_host_permissions`, granted only when the user enables a site |
| Silent filter failure after a site redesign | Health-check per adapter; visible "filtering degraded" status instead of quiet fail-open |
| Local device access reading the filter list | Local-only storage by default; sync (if ever offered) is opt-in and client-side encrypted |

### Out of scope (MVP)

- A logged-in attacker with full control of the user's device/profile.
- Image-only content analysis (explicitly deferred per product spec).
- Platforms actively and adversarially evading the extension.

## 2. Core security principles

1. **No servers, no accounts, no telemetry.** All state lives on the device.
   The privacy claim on the landing page should be verifiable by reading the
   manifest: there is nothing to leak *to*.
2. **Zero network permission.** The MVP makes no `fetch` calls to any host.
   Site adapter definitions ship inside the extension package and update
   through store review. This removes the entire exfiltration and
   remote-config-tampering surface.
3. **Least privilege, granted incrementally.** Only the sites the user turns
   on get host permissions, via `optional_host_permissions` at setup time.
   Never `<all_urls>` in the MVP.
4. **Code is code, config is data.** Site adapters are declarative JSON
   (selectors + extraction paths), validated against a strict schema. They
   cannot contain executable logic, so a bad adapter can at worst mis-select
   elements — it cannot run code.
5. **All page content is untrusted input.** Extracted titles/descriptions are
   handled as plain strings end to end; nothing page-derived is ever inserted
   as HTML or evaluated.
6. **Fail visible, not silent.** When an adapter stops matching the site's
   DOM, the user sees "filtering degraded on this site" rather than an
   unfiltered feed with a green checkmark.

## 3. Platform

- **Manifest V3**, targeting Chromium first (Chrome, Edge, Brave, Arc), with
  Firefox via the same codebase (WebExtensions + minor manifest differences).
  MV3 is required by Chrome and is security-positive for this project: remote
  code is forbidden, the background context is an ephemeral service worker,
  and the default extension-page CSP blocks inline script.
- **TypeScript** throughout, bundled with a standard extension toolchain
  (e.g. WXT or Vite + CRXJS). Everything is bundled; no CDN scripts.

## 4. Components

```
┌────────────────────────────────────────────────────────────┐
│ Extension package (all local, no network)                  │
│                                                            │
│  ┌──────────────┐   declarative    ┌──────────────────┐    │
│  │ Site adapters │──JSON, schema──▶│ Content script    │   │
│  │ (data only)   │   validated     │ (isolated world)  │   │
│  └──────────────┘                  │  - MutationObserver   │
│                                    │  - text extraction │   │
│  ┌──────────────┐    pure fn       │  - hide/placeholder│   │
│  │ Filter engine │◀───calls────────│                    │   │
│  │ (pure TS lib) │                 └───────┬──────────┘    │
│  └──────────────┘                          │ runtime msgs   │
│                                    ┌───────▼──────────┐    │
│  ┌──────────────┐                  │ Service worker    │    │
│  │ Popup/Options │◀────messages───▶│  - storage        │    │
│  │ UI (CSP-strict)│                │  - badge/status   │    │
│  └──────────────┘                  └──────────────────┘    │
│                                                            │
│  chrome.storage.local  (preferences, local-only)           │
└────────────────────────────────────────────────────────────┘
```

### 4.1 Filter engine (`packages/engine`)

- Pure TypeScript library. **No DOM access, no browser APIs, no I/O.**
  Input: `{ fields: string[] }` extracted from a card; output:
  `{ matched: boolean, ruleId?: string }`.
- Matching: case-insensitive, Unicode-normalized (NFKC) keyword and phrase
  matching with word-boundary awareness. Terms are compiled once per
  preference change into a single matcher (alternation regex or Aho-Corasick
  for large term sets) — never one regex per term per card.
- User terms are **treated as literals, never as regex source** without
  escaping — a user term like `(a+)+b` must not become a ReDoS vector or a
  syntax error.
- Pure and deterministic → exhaustively unit-testable and trivially
  auditable. This is the file a reviewer reads to trust the extension.

### 4.2 Site adapters (`packages/adapters`)

- One JSON document per supported site, validated at build time *and* at load
  time against a strict schema (unknown keys rejected). Each adapter declares:
  - URL match patterns and the page types it understands (home feed, watch
    page sidebar, search results page);
  - selectors for **recommendation containers** and **cards**;
  - extraction paths for text fields (title, channel/author, description,
    badge text) — `textContent`/attribute reads only;
  - which regions are *recommendations* vs *deliberate-search results*
    (search results pass through by default, per the product principle);
  - a **health-check selector**: an element that must exist on a supported
    page. If it's missing, the adapter is presumed broken by a site redesign
    and the UI reports degraded status.
- Because adapters are data, adding a site never widens the code attack
  surface, and a future remote-update channel (post-MVP, see §8) has a
  bounded blast radius.

### 4.3 Content script

- Runs in the **isolated world** (MV3 default). No MAIN-world injection in
  the MVP — we never need to touch the page's JavaScript state.
- Registered per-site, only for sites with granted permission, at
  `document_start`.
- **No flash of unfiltered content:** at `document_start` it injects a
  stylesheet that visually suppresses the adapter's recommendation containers
  (e.g. `visibility: hidden` on card media) until the first scan completes,
  then reveals non-matching cards. For a user avoiding distressing imagery, a
  200 ms flash of the thumbnail defeats the product.
- A debounced `MutationObserver` handles infinite scroll and SPA navigation;
  decisions are cached per card element (`WeakSet`) so cards are scanned once.
- **Hiding mechanism:** matched cards get a class that collapses them or
  swaps in a neutral placeholder. The placeholder is built with
  `document.createElement` + `textContent` only. The placeholder does **not**
  passively display the matched term or rule (a shoulder-surfer must not
  learn the user's filters from the page); it offers a "reveal this item"
  affordance, plus a "Why?" button that shows the matched filter only on
  explicit click.
- "Hide entire section" mode simply collapses the adapter's container
  selector — cheaper and even less error-prone.
- The content script holds the compiled matcher in memory; it receives
  preference updates via runtime messages and never writes storage itself
  (single-writer discipline: only the service worker mutates preferences).

### 4.4 Service worker (background)

Deliberately minimal — it is the most privileged context, so it does the
least:

- Owns `chrome.storage.local` reads/writes for preferences.
- Brokers messages between UI and content scripts.
- Maintains per-tab status (active / unsupported site / degraded) for the
  toolbar badge.
- **Message hygiene:** every handler verifies `sender.id ===
  chrome.runtime.id`, checks `sender.url`/`sender.origin` against
  expectations (content script messages must come from a granted host), and
  validates the payload against a schema before acting. Unknown message types
  are dropped. No `externally_connectable` entry exists in the manifest, so
  web pages and other extensions cannot message us at all.

### 4.5 Popup & options UI

- Extension pages with the MV3 default CSP (no inline script, no `eval`).
- User-entered terms are rendered via `textContent`/framework text binding —
  never interpolated into HTML. (The user's own terms are low-risk, but
  imported preference files are not — see §5.)
- The popup shows, per the product spec: active/supported status on the
  current tab, pause toggle, quick add, and the degraded-adapter warning.

## 5. Data: storage, sync, import/export

- **`chrome.storage.local` only** for the MVP. No account, nothing leaves the
  device. Preferences survive browser restarts; "preferences remain effective
  across sessions" comes for free.
- **Do not use `chrome.storage.sync` by default.** Sync data is stored on the
  browser vendor's servers tied to the user's account, unencrypted from the
  extension's point of view. Given the sensitivity of filter terms, sync (if
  ever offered) must be opt-in with a clear explanation, and should
  client-side encrypt the term list with a user passphrase (WebCrypto,
  AES-GCM, key derived via PBKDF2/Argon2) before it touches sync storage.
- **Export/import** (useful for moving browsers): exported file is plain JSON
  the user controls. On **import**, validate strictly against the preferences
  schema, enforce size/count limits, and treat every string as untrusted
  (escape on display, never execute). Offer passphrase-encrypted export for
  the same shoulder-surfing/backup reasons.
- **Preference schema is versioned** (`schemaVersion`) with explicit
  migrations, so updates never silently drop a user's boundaries.
- **No logging of terms.** Terms never appear in `console.log`, error
  messages, or any diagnostic output. There is no crash reporting or
  analytics of any kind in the MVP; if ever added, it is opt-in and may carry
  aggregate counts only — never terms, never URLs.

## 6. Permissions (manifest)

```jsonc
{
  "manifest_version": 3,
  "permissions": ["storage", "scripting"],
  "optional_host_permissions": [
    "*://*.youtube.com/*",
    "*://*.pinterest.com/*",
    "*://*.instagram.com/*"
    // one entry per supported site
  ],
  "host_permissions": []        // none by default
  // no "tabs", no "webRequest", no "<all_urls>", no "externally_connectable"
}
```

- Host access is requested **only when the user enables a site** during setup
  (`chrome.permissions.request` from a user gesture) and content scripts are
  registered dynamically (`chrome.scripting.registerContentScripts`) only for
  granted origins.
- This keeps the install-time warning minimal, makes store review easier, and
  means a compromise of the extension is bounded to the sites the user
  actually enabled.

## 7. Supply chain & release integrity

- **Runtime dependencies: as close to zero as possible.** The engine is small
  enough to need none; the UI may use one well-known framework (or none).
  Every dependency is a party the user implicitly trusts with their feeds.
- Pinned lockfile, `npm audit`/OSV scanning in CI, and a minimum-package-age
  policy for new deps (mitigates fresh-package typosquatting/hijacks).
- Deterministic build in CI from a tagged commit; the store artifact is built
  only by CI, never from a laptop. Source is public so the "nothing leaves
  your device" claim is auditable.
- MV3 already forbids remotely hosted code; we additionally ship **no remote
  configuration** (see §8 for the post-MVP path).

## 8. Post-MVP: updating adapters without store review

Sites redesign their DOM often; store review latency (days) means broken
filtering windows. When that pain justifies it, add a **signed adapter
update channel** — the only network feature the extension should ever gain:

- Extension fetches a single static JSON bundle over HTTPS from a recreg
  domain (a GET with no identifying payload — no user data ever flows out).
- The bundle is signed offline; the public key ships in the extension and the
  signature is verified (WebCrypto, Ed25519/ECDSA) before use. A compromised
  CDN then cannot inject adapters.
- Adapters remain schema-validated data — even a malicious signed bundle
  cannot execute code, only mis-hide/mis-reveal elements.
- Updates are versioned and monotonic (no rollback to older, broken ones).

Until then: adapters ship in the package, and the health-check + degraded
status keeps failures honest.

## 9. Reliability & performance (as product-safety requirements)

- Compiled matcher + per-card decision cache keeps scan cost ~O(new cards).
  Target: no measurable scroll jank on a YouTube home feed (hundreds of
  cards).
- Debounce MutationObserver bursts; process in `requestIdleCallback` chunks
  when a large batch arrives, but always *after* the suppress-until-scanned
  CSS is in place so slowness never causes a content flash.
- Adapter health checks run on page load and on SPA navigation; degraded
  state surfaces in the badge and popup.
- Integration tests run adapters against **saved DOM fixtures** of each
  supported site (periodically refreshed), so CI catches selector drift
  without scraping live sites.

## 10. Repository layout

```
recreg/
├── packages/
│   ├── engine/          # pure matching library + exhaustive unit tests
│   └── adapters/        # per-site JSON + schema + fixture-based tests
├── extension/
│   ├── manifest.json
│   ├── background/      # service worker: storage, messaging, badge
│   ├── content/         # scanner, hider, placeholder UI
│   └── ui/              # popup + options (setup flow, previews)
├── site/                # static landing page (separate deploy, no coupling)
└── ARCHITECTURE.md
```

## 11. Security checklist (pre-release)

- [ ] Manifest contains no network-enabling or broad permissions; diff-review
      the manifest on every release.
- [ ] `grep` gate in CI: no `fetch(`, `XMLHttpRequest`, `innerHTML`,
      `insertAdjacentHTML`, `eval`, `new Function` outside allowlisted files.
- [ ] All runtime message handlers validate sender + payload schema.
- [ ] User terms regex-escaped before compilation (ReDoS test in engine suite).
- [ ] Import path fuzzed with malformed/oversized JSON.
- [ ] No term strings in any log output (test asserts this).
- [ ] Flash-of-unfiltered-content test on each supported site fixture.
- [ ] Store listing privacy claims match the manifest exactly.
