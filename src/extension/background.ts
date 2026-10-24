// recreg service worker. The most privileged context, so it does the least:
// owns preference writes, registers/unregisters per-site content scripts to
// match granted permissions, and keeps the toolbar badge per tab.
//
// Message hygiene: every message must come from this extension
// (sender.id check); payloads are schema-validated before use. There is no
// externally_connectable surface — pages and other extensions can't reach us.

import { ADAPTERS } from "../adapters";
import { DEFAULT_PREFS, validatePreferences, type Preferences } from "../engine/prefs";

async function getPrefs(): Promise<Preferences> {
  const obj = await chrome.storage.local.get("prefs");
  return validatePreferences(obj["prefs"]) ?? DEFAULT_PREFS;
}

async function setPrefs(input: unknown): Promise<void> {
  const prefs = validatePreferences(input);
  if (!prefs) throw new Error("invalid preferences");
  await chrome.storage.local.set({ prefs });
  await syncRegistrations();
}

/** Register content scripts only for sites that are enabled AND granted. */
async function syncRegistrations(): Promise<void> {
  const prefs = await getPrefs();
  const registered = await chrome.scripting.getRegisteredContentScripts();
  const registeredIds = new Set(registered.map((s) => s.id));

  for (const adapter of ADAPTERS) {
    const scriptId = `recreg-${adapter.id}`;
    const enabled = prefs.sites[adapter.id]?.enabled === true;
    const granted = await chrome.permissions.contains({ origins: adapter.matches });
    const want = enabled && granted;

    if (want && !registeredIds.has(scriptId)) {
      await chrome.scripting.registerContentScripts([
        {
          id: scriptId,
          matches: adapter.matches,
          js: ["content.js"],
          runAt: "document_start",
          persistAcrossSessions: true,
        },
      ]);
    } else if (!want && registeredIds.has(scriptId)) {
      await chrome.scripting.unregisterContentScripts({ ids: [scriptId] });
    }
  }
}

chrome.runtime.onInstalled.addListener((details) => {
  void syncRegistrations();
  // First install: open settings so setup continues instead of ending in
  // silence — the user lands where sites get enabled and filters added.
  if (details.reason === "install") {
    void chrome.runtime.openOptionsPage();
  }
});
chrome.runtime.onStartup.addListener(() => {
  void syncRegistrations();
});
chrome.permissions.onRemoved.addListener(() => {
  void syncRegistrations();
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return;
  if (!msg || typeof msg !== "object" || typeof (msg as { type?: unknown }).type !== "string") return;

  switch ((msg as { type: string }).type) {
    case "recreg:status": {
      // From content scripts: update the per-tab badge with the hidden count.
      const tabId = sender.tab?.id;
      const count = (msg as { hiddenCount?: unknown }).hiddenCount;
      if (tabId !== undefined && typeof count === "number" && Number.isFinite(count)) {
        const text = count > 0 ? String(Math.min(Math.floor(count), 999)) : "";
        void chrome.action.setBadgeText({ tabId, text });
        void chrome.action.setBadgeBackgroundColor({ tabId, color: "#d9739a" });
      }
      return;
    }
    case "recreg:getPrefs": {
      void getPrefs().then(sendResponse);
      return true;
    }
    case "recreg:setPrefs": {
      setPrefs((msg as { prefs?: unknown }).prefs).then(
        () => sendResponse({ ok: true }),
        (err: unknown) => sendResponse({ ok: false, error: String(err) }),
      );
      return true;
    }
    case "recreg:syncRegistrations": {
      syncRegistrations().then(
        () => sendResponse({ ok: true }),
        () => sendResponse({ ok: false }),
      );
      return true;
    }
    default:
      return;
  }
});
