// Popup: status on the current tab, pause toggle, quick-add filter.

import { el, clear } from "./dom";
import { ADAPTERS } from "../adapters";
import { randomId, type Preferences } from "../engine/prefs";

interface TabStatus {
  adapterId: string;
  siteName: string;
  healthy: boolean;
  hiddenCount: number;
  sentCount?: number;
  active: boolean;
}

const app = document.getElementById("app") as HTMLElement;

async function getPrefs(): Promise<Preferences> {
  return chrome.runtime.sendMessage({ type: "recreg:getPrefs" });
}

async function setPrefs(prefs: Preferences): Promise<void> {
  await chrome.runtime.sendMessage({ type: "recreg:setPrefs", prefs });
}

async function queryTabStatus(): Promise<TabStatus | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return null;
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { type: "recreg:queryStatus" });
    return res && typeof res.adapterId === "string" ? (res as TabStatus) : null;
  } catch {
    return null; // no content script on this tab
  }
}

function statusRow(label: string, tone: "ok" | "warn" | "muted"): HTMLElement {
  return el("div", { class: `status status-${tone}` }, [
    el("span", { class: "dot" }),
    el("span", {}, [label]),
  ]);
}

async function render(): Promise<void> {
  const [prefs, status] = await Promise.all([getPrefs(), queryTabStatus()]);
  clear(app);

  app.append(el("header", { class: "popup-head" }, [
    el("img", { src: "icons/icon48.png", alt: "", width: "36", height: "36" }),
    el("div", {}, [
      el("h1", {}, ["recreg"]),
      el("span", { class: "tagline" }, ["your feed, your rules"]),
    ]),
  ]));

  if (status) {
    if (!status.healthy) {
      app.append(statusRow(`Filtering degraded on ${status.siteName} — the site may have changed`, "warn"));
    } else if (prefs.paused) {
      app.append(statusRow("Paused everywhere", "muted"));
    } else if (!status.active) {
      app.append(statusRow(`No active filters on ${status.siteName}`, "muted"));
    } else {
      const sent = status.sentCount ?? 0;
      app.append(
        statusRow(
          `Active on ${status.siteName} — ${status.hiddenCount} hidden on this page` +
            (sent > 0 ? `, ${sent} sent to ${status.siteName}` : ""),
          "ok",
        ),
      );
    }
  } else {
    app.append(statusRow("Not active on this page (unsupported site, or reload the tab after enabling)", "muted"));
  }

  // Pause toggle
  const pauseBtn = el("button", { class: "btn", type: "button" }, [
    prefs.paused ? "Resume filtering" : "Pause filtering",
  ]);
  pauseBtn.addEventListener("click", async () => {
    prefs.paused = !prefs.paused;
    await setPrefs(prefs);
    await render();
  });

  // Quick add
  const input = el("input", {
    type: "text",
    placeholder: "Quick add: word or phrase…",
    maxlength: "200",
    "aria-label": "Add filter term",
  });
  const addBtn = el("button", { class: "btn btn-primary", type: "button" }, ["Add"]);
  const add = async () => {
    const term = input.value.trim();
    if (!term) return;
    prefs.rules.push({
      id: randomId(),
      term,
      matchType: term.includes(" ") ? "phrase" : "word",
      enabled: true,
    });
    await setPrefs(prefs);
    input.value = "";
    await render();
  };
  addBtn.addEventListener("click", add);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") void add();
  });

  // Auto "Not interested": one toggle per site that supports it (YouTube).
  // Off by default; the same toggle lives in settings.
  const autoRows = ADAPTERS.filter((a) => a.feedback).map((adapter) => {
    const settings = prefs.sites[adapter.id] ?? { enabled: false };
    const toggle = el("input", { type: "checkbox", "aria-label": `Automatically tell ${adapter.name} "not interested" for filtered videos` }) as HTMLInputElement;
    toggle.checked = settings.autoFeedback === true;
    toggle.addEventListener("change", async () => {
      prefs.sites[adapter.id] = { ...(prefs.sites[adapter.id] ?? { enabled: false }), autoFeedback: toggle.checked };
      await setPrefs(prefs);
      await render();
    });
    return el("label", { class: "popup-toggle" }, [
      toggle,
      el("span", {}, [
        el("strong", {}, [`Auto "Not interested" on ${adapter.name}`]),
        el("small", {}, [
          `Filtered videos are reported to ${adapter.name} as you scroll, using your signed-in account. ${adapter.name} then shows its own Undo notice instead of the recreg cover. A ${adapter.name} menu may open briefly.`,
        ]),
      ]),
    ]);
  });

  const optionsLink = el("button", { class: "btn btn-ghost", type: "button" }, ["Open settings"]);
  optionsLink.addEventListener("click", () => chrome.runtime.openOptionsPage());

  app.append(
    el("div", { class: "quick-add" }, [input, addBtn]),
    ...autoRows,
    el("div", { class: "popup-actions" }, [pauseBtn, optionsLink]),
    el("footer", { class: "popup-foot" }, [`${prefs.rules.filter((r) => r.enabled).length} active filters`]),
  );
}

void render();
