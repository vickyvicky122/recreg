// recreg content script. Runs in the isolated world, registered per-site
// only after the user grants that site's permission.
//
// Security invariants:
// - All page content is untrusted text: read via textContent/getAttribute,
//   never inserted back as HTML.
// - Matched terms are never written into the page (placeholders don't name
//   the rule — a shoulder-surfer must not learn the user's filters).
// - This script never writes preferences; it reads storage and listens for
//   changes (single-writer: the service worker).

import { ADAPTERS, adapterForHost } from "../adapters";
import type { Region, SiteAdapter } from "../adapters/schema";
import { compileMatcher, type Matcher } from "../engine/matcher";
import { DEFAULT_PREFS, validatePreferences, type Preferences } from "../engine/prefs";

const ATTR_CHECKED = "data-recreg-checked";
const ATTR_HIDDEN = "data-recreg-hidden";
const ATTR_COVERED = "data-recreg-covered";
const ATTR_SECTION = "data-recreg-section";

const adapter: SiteAdapter | null = adapterForHost(ADAPTERS, location.hostname);

if (adapter) {
  main(adapter);
}

function main(site: SiteAdapter): void {
  let prefs: Preferences = DEFAULT_PREFS;
  let matcher: Matcher = compileMatcher([], site.id);
  let hiddenCount = 0;
  let healthy = true;
  let lastHref = location.href;
  let scanScheduled = false;
  let lastReport = "";

  const revealed = new WeakSet<Element>();
  const firstSeen = new WeakMap<Element, number>();

  // ---------- styles ----------

  const styleEl = document.createElement("style");
  styleEl.setAttribute("data-recreg", "");
  (document.head ?? document.documentElement).appendChild(styleEl);


  function baseCss(): string {
    return [
      `[${ATTR_HIDDEN}] { display: none !important; }`,
      `[${ATTR_SECTION}] { display: none !important; }`,
      `[${ATTR_COVERED}] { position: relative !important; }`,
      `.recreg-cover { position: absolute; inset: 0; z-index: 2147483000; display: flex;`,
      `  flex-direction: column; align-items: center; justify-content: center; gap: 10px;`,
      `  background: #fdeef4 radial-gradient(#f0b6c9 1.2px, transparent 1.4px) 0 0 / 9px 9px; color: #3d3236; border-radius: 14px;`,
      `  font: 500 13px/1.4 system-ui, -apple-system, sans-serif; text-align: center; padding: 8px; }`,
      `.recreg-cover button { cursor: pointer; border: 1px solid #e49cb5; border-radius: 999px;`,
      `  background: #fff; color: #3d3236; font: 600 12px system-ui, sans-serif; padding: 4px 14px; }`,
      `.recreg-cover button:hover { background: #f4b3c9; color: #3d3236; }`,
      `.recreg-cover .recreg-why { border: 0; background: transparent; color: #7a6a70;`,
      `  font: 400 11px system-ui, sans-serif; padding: 0; }`,
      `.recreg-cover button.recreg-why:hover { background: transparent; color: #3d3236; text-decoration: underline; }`,
    ].join("\n");
  }

  function suppressCss(): string {
    // Anti-flash: keep not-yet-checked cards invisible until first scan.
    // visibility (not display) so layout stays stable and the observer
    // still sees them render. A 2s interval backstop guarantees progress.
    //
    // Scoped to container+card pairs: scanning only happens inside known
    // containers, so an unscoped rule would permanently hide card-shaped
    // elements elsewhere on the page (search results, redesigned sections)
    // that no scan ever marks as checked.
    const pairs: string[] = [];
    for (const region of site.regions) {
      for (const container of region.containers) {
        for (const card of region.cards) {
          pairs.push(`${container} ${card}:not([${ATTR_CHECKED}])`);
        }
      }
    }
    return pairs.join(",\n") + " { visibility: hidden !important; }";
  }

  function filteringActive(): boolean {
    if (prefs.paused) return false;
    const ss = prefs.sites[site.id];
    if (ss && ss.enabled === false) return false;
    return matcher.ruleCount > 0 || sectionsHidden();
  }

  function sectionsHidden(): boolean {
    return prefs.sites[site.id]?.hideSections === true;
  }

  function updateStyles(): void {
    const active = filteringActive();
    styleEl.textContent = active && !sectionsHidden() ? baseCss() + "\n" + suppressCss() : baseCss();
  }

  // ---------- marks ----------

  function resetMarks(): void {
    hiddenCount = 0;
    for (const el of document.querySelectorAll(`[${ATTR_CHECKED}], [${ATTR_HIDDEN}], [${ATTR_COVERED}], [${ATTR_SECTION}]`)) {
      el.removeAttribute(ATTR_CHECKED);
      el.removeAttribute(ATTR_HIDDEN);
      el.removeAttribute(ATTR_COVERED);
      el.removeAttribute(ATTR_SECTION);
    }
    for (const cover of document.querySelectorAll(".recreg-cover")) cover.remove();
  }

  // ---------- extraction & hiding ----------

  function extractText(card: Element, region: Region): string {
    const parts: string[] = [];
    for (const src of region.text) {
      if (src.selector === "") {
        const v = src.attr ? card.getAttribute(src.attr) : null;
        if (v) parts.push(v);
        continue;
      }
      const found = card.querySelectorAll(src.selector);
      for (let i = 0; i < found.length && i < 8; i++) {
        const el = found[i];
        if (!el) continue;
        const v = src.attr ? el.getAttribute(src.attr) : el.textContent;
        if (v && v.trim()) parts.push(v);
      }
    }
    return parts.join(" ");
  }

  function hideCard(card: HTMLElement, matchedTerm: string): void {
    hiddenCount++;
    if (prefs.mode === "hide") {
      card.setAttribute(ATTR_HIDDEN, "");
      return;
    }
    card.setAttribute(ATTR_COVERED, "");
    const cover = document.createElement("div");
    cover.className = "recreg-cover";
    const label = document.createElement("div");
    label.textContent = "Hidden by recreg";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "Show";
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      revealed.add(card);
      card.removeAttribute(ATTR_COVERED);
      cover.remove();
      hiddenCount = Math.max(0, hiddenCount - 1);
      reportStatus();
    });
    cover.addEventListener("click", (e) => {
      // Swallow clicks so the underlying card link doesn't open.
      e.preventDefault();
      e.stopPropagation();
    });
    // "Why?" reveals the matched filter only on explicit click, so the
    // page never passively displays the user's filter list.
    const why = document.createElement("button");
    why.type = "button";
    why.className = "recreg-why";
    why.textContent = "Why?";
    why.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const reason = document.createElement("div");
      reason.className = "recreg-why";
      reason.textContent = `Matches your filter: ${matchedTerm}`;
      why.replaceWith(reason);
    });
    cover.append(label, btn, why);
    card.appendChild(cover);
  }

  // ---------- platform feedback ("Not interested") ----------
  //
  // Opt-in per site. For each newly hidden card, drive the platform's own
  // dismissal flow (open the card's action menu, click its "not interested"
  // item) so the recommender learns, instead of recreg only hiding locally.
  // Best-effort and fail-safe: menu items are matched by EXACT label, one
  // card is processed at a time with a fixed pause between cards, and an
  // unmatched menu is closed and never retried.

  const FEEDBACK_PAUSE_MS = 5000;
  const FEEDBACK_MENU_TIMEOUT_MS = 1500;
  const feedbackDone = new WeakSet<Element>();
  const feedbackQueue: HTMLElement[] = [];
  let feedbackBusy = false;

  function autoFeedbackActive(): boolean {
    return !!site.feedback && prefs.sites[site.id]?.autoFeedback === true && !prefs.paused;
  }

  function queueFeedback(card: HTMLElement): void {
    if (!autoFeedbackActive() || feedbackDone.has(card)) return;
    feedbackDone.add(card);
    feedbackQueue.push(card);
    void drainFeedbackQueue();
  }

  async function drainFeedbackQueue(): Promise<void> {
    if (feedbackBusy) return;
    feedbackBusy = true;
    try {
      while (feedbackQueue.length > 0) {
        const card = feedbackQueue.shift();
        if (!card || !card.isConnected || !autoFeedbackActive()) continue;
        try {
          await sendFeedback(card);
        } catch {
          // Never let a feedback attempt break the page.
        }
        await sleep(FEEDBACK_PAUSE_MS);
      }
    } finally {
      feedbackBusy = false;
    }
  }

  async function sendFeedback(card: HTMLElement): Promise<void> {
    const fb = site.feedback;
    if (!fb) return;
    let button: HTMLElement | null = null;
    for (const sel of fb.menuButton) {
      try {
        button = card.querySelector<HTMLElement>(sel);
      } catch {
        continue;
      }
      if (button) break;
    }
    if (!button) return;
    button.click();
    const item = await waitForMenuItem(fb.menuItems, fb.itemLabels);
    if (item) {
      item.click();
    } else {
      // Unknown menu (locale or DOM drift): close it and leave the card
      // covered locally. Iron-dropdowns close on Escape.
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    }
  }

  async function waitForMenuItem(selectors: string[], labels: string[]): Promise<HTMLElement | null> {
    const deadline = Date.now() + FEEDBACK_MENU_TIMEOUT_MS;
    while (Date.now() < deadline) {
      for (const sel of selectors) {
        let items: NodeListOf<HTMLElement>;
        try {
          items = document.querySelectorAll<HTMLElement>(sel);
        } catch {
          continue;
        }
        for (const item of items) {
          if (item.getBoundingClientRect().width === 0) continue; // closed/reused popup
          const label = (item.textContent ?? "").trim().toLowerCase();
          if (labels.includes(label)) return item;
        }
      }
      await sleep(100);
    }
    return null;
  }

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function processCard(card: HTMLElement, region: Region): void {
    if (card.hasAttribute(ATTR_CHECKED) || revealed.has(card)) return;
    const text = extractText(card, region);
    if (!text.trim()) {
      // Card may still be rendering (skeleton). Leave it pending (and
      // suppressed) briefly; give up and pass it through after 3s.
      const seen = firstSeen.get(card);
      const now = Date.now();
      if (seen === undefined) {
        firstSeen.set(card, now);
        return;
      }
      if (now - seen < 1500) return;
      card.setAttribute(ATTR_CHECKED, "");
      return;
    }
    card.setAttribute(ATTR_CHECKED, "");
    const hit = matcher.match(text);
    if (hit) {
      hideCard(card, hit.term);
      queueFeedback(card);
    }
  }

  // ---------- scanning ----------

  function scan(): void {
    if (location.href !== lastHref) {
      // SPA navigation: start fresh so stale marks don't leak across pages.
      lastHref = location.href;
      resetMarks();
    }
    healthy = !!document.querySelector(site.healthCheck);
    if (!filteringActive()) {
      reportStatus();
      return;
    }
    const hideSections = sectionsHidden();
    for (const region of site.regions) {
      for (const containerSel of region.containers) {
        let containers: NodeListOf<Element>;
        try {
          containers = document.querySelectorAll(containerSel);
        } catch {
          continue;
        }
        for (const container of containers) {
          if (hideSections) {
            container.setAttribute(ATTR_SECTION, "");
            continue;
          }
          for (const cardSel of region.cards) {
            let cards: NodeListOf<Element>;
            try {
              cards = container.querySelectorAll(cardSel);
            } catch {
              continue;
            }
            for (const card of cards) {
              processCard(card as HTMLElement, region);
            }
          }
        }
      }
    }
    reportStatus();
  }

  function scheduleScan(): void {
    if (scanScheduled) return;
    scanScheduled = true;
    setTimeout(() => {
      scanScheduled = false;
      try {
        scan();
      } catch {
        // Never let a scan error break the page.
      }
    }, 80);
  }

  // ---------- status reporting ----------

  function reportStatus(): void {
    const active = filteringActive();
    const key = `${healthy}|${hiddenCount}|${active}`;
    if (key === lastReport) return;
    lastReport = key;
    void chrome.runtime
      .sendMessage({ type: "recreg:status", adapterId: site.id, healthy, hiddenCount, active })
      .catch(() => {
        /* service worker may be waking; next report will land */
      });
  }

  // ---------- preferences ----------

  function applyPrefs(next: Preferences): void {
    prefs = next;
    matcher = compileMatcher(prefs.rules, site.id);
    resetMarks();
    updateStyles();
    lastReport = "";
    scheduleScan();
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes["prefs"]) return;
    applyPrefs(validatePreferences(changes["prefs"].newValue) ?? DEFAULT_PREFS);
  });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) return;
    if (msg && msg.type === "recreg:queryStatus") {
      sendResponse({
        adapterId: site.id,
        siteName: site.name,
        healthy,
        hiddenCount,
        active: filteringActive(),
      });
    }
  });

  // ---------- boot ----------

  updateStyles(); // base css immediately; suppression once prefs load

  void chrome.storage.local.get("prefs").then((obj) => {
    applyPrefs(validatePreferences(obj["prefs"]) ?? DEFAULT_PREFS);
  });

  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  // Backstop: guarantees pending (suppressed) cards get resolved even if a
  // mutation burst was missed, and keeps health status fresh on SPA sites.
  setInterval(scheduleScan, 2000);
}
