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
      `.recreg-cover { position: absolute; inset: 0; z-index: 2147483000; display: flex; container-type: inline-size;`,
      `  flex-direction: column; align-items: center; justify-content: center; gap: 10px;`,
      `  background: #fdeef4 radial-gradient(#f0b6c9 1.2px, transparent 1.4px) 0 0 / 9px 9px; color: #3d3236; border-radius: 14px;`,
      `  font: 500 13px/1.4 system-ui, -apple-system, sans-serif; text-align: center; padding: 8px; }`,
      `.recreg-actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; }`,
      `@container (max-width: 340px) { .recreg-actions { flex-direction: column; align-items: stretch; width: 100%; max-width: 230px; } }`,
      `.recreg-cover button { cursor: pointer; border-radius: 999px; color: #3d3236; font: 600 12px system-ui, sans-serif; padding: 5px 14px; }`,
      `.recreg-cover button.recreg-outline { background: transparent; border: 1.5px solid #c9788f; }`,
      `.recreg-cover button.recreg-outline:hover { background: #fff; }`,
      `.recreg-cover button.recreg-filled { background: #f4b3c9; border: 1.5px solid #e49cb5; }`,
      `.recreg-cover button.recreg-filled:hover { background: #efa3bd; }`,
      `.recreg-cover button:disabled { opacity: 0.6; cursor: default; }`,
      `.recreg-note { font: 400 11px system-ui, sans-serif; color: #7a6a70; }`,
      `.recreg-note:empty { display: none; }`,
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
    const actions = document.createElement("div");
    actions.className = "recreg-actions";
    const note = document.createElement("div");
    note.className = "recreg-note";

    // "Show": reveals the original card. Sends nothing to the platform.
    const showBtn = document.createElement("button");
    showBtn.type = "button";
    showBtn.className = "recreg-outline";
    showBtn.textContent = "Show";
    showBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      revealed.add(card);
      card.removeAttribute(ATTR_COVERED);
      cover.remove();
      hiddenCount = Math.max(0, hiddenCount - 1);
      reportStatus();
    });

    // "Not interested on YouTube": only built when the user opted in, and
    // only ever sent by this explicit click, never automatically.
    const niBtn = document.createElement("button");
    niBtn.type = "button";
    niBtn.className = "recreg-filled";
    niBtn.textContent = "Not interested on YouTube";
    niBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (feedbackBusy) return;
      feedbackBusy = true;
      niBtn.disabled = true;
      note.textContent = "";
      sendFeedback(card)
        .then((sent) => {
          if (sent) {
            // YouTube now shows its own "Video removed" notice (with its
            // Undo / Tell us why). Remove our cover so it is visible and
            // usable by the user; recreg never touches that notice.
            revealed.add(card);
            card.removeAttribute(ATTR_COVERED);
            cover.remove();
          } else {
            note.textContent = "Couldn't reach YouTube's menu. Nothing was sent.";
            niBtn.disabled = false;
          }
        })
        .catch(() => {
          note.textContent = "Couldn't reach YouTube's menu. Nothing was sent.";
          niBtn.disabled = false;
        })
        .finally(() => {
          feedbackBusy = false;
        });
    });

    function showDefault(): void {
      label.textContent = "Hidden by recreg";
      note.textContent = "";
      niBtn.disabled = false;
      actions.replaceChildren(showBtn, ...(feedbackButtonActive() ? [niBtn] : []));
      why.hidden = false;
    }

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
    showDefault();
    cover.append(label, actions, note, why);
    card.appendChild(cover);
  }

  // ---------- platform feedback ("Not interested") ----------
  //
  // Opt-in per site, and only ever triggered by the user pressing the
  // cover's "Not interested on YouTube" button. recreg never sends it on its
  // own. The click drives the platform's own dismissal flow (open the card's
  // action menu, click its "not interested" item). Best-effort and fail-safe:
  // menu items are matched by EXACT label, and an unmatched menu is closed.
  //
  // After the click, the cover is removed so the platform's own notice
  // ("Video removed", Undo, Tell us why) is shown to the user. recreg never
  // clicks, fills in or submits any of it, including "Tell us why".

  const FEEDBACK_MENU_TIMEOUT_MS = 1500;
  let feedbackBusy = false;

  function feedbackButtonActive(): boolean {
    return !!site.feedback && prefs.sites[site.id]?.feedbackButton === true;
  }

  async function sendFeedback(card: HTMLElement): Promise<boolean> {
    const fb = site.feedback;
    if (!fb || !feedbackButtonActive()) return false;
    let button: HTMLElement | null = null;
    for (const sel of fb.menuButton) {
      try {
        button = card.querySelector<HTMLElement>(sel);
      } catch {
        continue;
      }
      if (button) break;
    }
    if (!button) return false;
    button.click();
    const item = await waitForMenuItem(fb.menuItems, fb.itemLabels);
    if (item) {
      item.click();
      return true;
    }
    // Unknown menu (locale or DOM drift): close it and leave the card
    // covered locally. Iron-dropdowns close on Escape.
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    return false;
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
    if (hit) hideCard(card, hit.term);
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
