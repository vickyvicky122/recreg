// Options page: sites, filters, presets, behavior, live preview,
// export/import. All user/imported strings are rendered as text nodes only.

import { el, clear } from "./dom";
import { ADAPTERS } from "../adapters";
import { compileMatcher } from "../engine/matcher";
import { PRESETS } from "../engine/presets";
import {
  randomId,
  validatePreferences,
  DEFAULT_PREFS,
  type Preferences,
  type Rule,
  type MatchType,
} from "../engine/prefs";
import { SAMPLE_CARDS } from "../shared/samples";

const app = document.getElementById("app") as HTMLElement;
let prefs: Preferences = DEFAULT_PREFS;

async function loadPrefs(): Promise<void> {
  prefs = await chrome.runtime.sendMessage({ type: "recreg:getPrefs" });
}

async function savePrefs(): Promise<void> {
  const res = await chrome.runtime.sendMessage({ type: "recreg:setPrefs", prefs });
  if (!res?.ok) {
    console.warn("recreg: preferences rejected");
    await loadPrefs();
  }
  render();
}

function section(title: string, hint: string, children: Array<Node | string>): HTMLElement {
  return el("section", { class: "card" }, [
    el("h2", {}, [title]),
    el("p", { class: "hint" }, [hint]),
    ...children,
  ]);
}

// ---------- sites ----------

function sitesSection(): HTMLElement {
  const rows = ADAPTERS.map((adapter) => {
    const settings = prefs.sites[adapter.id] ?? { enabled: false };
    const toggle = el("input", { type: "checkbox", "aria-label": `Enable on ${adapter.name}` }) as HTMLInputElement;
    toggle.checked = settings.enabled;
    toggle.addEventListener("change", async () => {
      if (toggle.checked) {
        // Permission request must happen in this user gesture.
        const granted = await chrome.permissions.request({ origins: adapter.matches });
        if (!granted) {
          toggle.checked = false;
          return;
        }
      }
      prefs.sites[adapter.id] = { ...settings, enabled: toggle.checked };
      await savePrefs();
    });

    const sectionsToggle = el("input", { type: "checkbox", "aria-label": `Hide all recommendation sections on ${adapter.name}` }) as HTMLInputElement;
    sectionsToggle.checked = settings.hideSections === true;
    sectionsToggle.addEventListener("change", async () => {
      prefs.sites[adapter.id] = { ...(prefs.sites[adapter.id] ?? { enabled: false }), hideSections: sectionsToggle.checked };
      await savePrefs();
    });

    const subOptions: HTMLElement[] = [
      el("label", { class: "sub-option" }, [sectionsToggle, "hide entire recommendation sections"]),
    ];

    if (adapter.feedback) {
      const feedbackToggle = el("input", { type: "checkbox", "aria-label": `Show a "Not interested on ${adapter.name}" button on hidden items` }) as HTMLInputElement;
      feedbackToggle.checked = settings.feedbackButton === true;
      feedbackToggle.addEventListener("change", async () => {
        prefs.sites[adapter.id] = { ...(prefs.sites[adapter.id] ?? { enabled: false }), feedbackButton: feedbackToggle.checked };
        await savePrefs();
      });
      subOptions.push(
        el("label", { class: "sub-option" }, [
          feedbackToggle,
          `Show a 'Not interested on ${adapter.name}' button on hidden items. Tapping it tells ${adapter.name} using your signed-in account. A ${adapter.name} menu may open briefly.`,
        ]),
      );

      const autoToggle = el("input", { type: "checkbox", "aria-label": `Automatically tell ${adapter.name} "not interested" for filtered videos` }) as HTMLInputElement;
      autoToggle.checked = settings.autoFeedback === true;
      autoToggle.addEventListener("change", async () => {
        prefs.sites[adapter.id] = { ...(prefs.sites[adapter.id] ?? { enabled: false }), autoFeedback: autoToggle.checked };
        await savePrefs();
      });
      subOptions.push(
        el("label", { class: "sub-option" }, [
          autoToggle,
          `Automatically tell ${adapter.name} 'Not interested' for every filtered video, as you scroll. ${adapter.name} then shows its own Undo notice instead of the recreg cover. Uses your signed-in account; a ${adapter.name} menu may open briefly.`,
        ]),
      );
    }

    return el("div", { class: "site-row" }, [
      el("label", { class: "switch" }, [toggle, el("strong", {}, [adapter.name])]),
      ...subOptions,
    ]);
  });

  return section(
    "Websites",
    "recreg only gets access to sites you enable. Reload open tabs after enabling a site.",
    rows,
  );
}

// ---------- filters ----------

function ruleRow(rule: Rule): HTMLElement {
  const enabled = el("input", { type: "checkbox", "aria-label": `Enable filter ${rule.term}` }) as HTMLInputElement;
  enabled.checked = rule.enabled;
  enabled.addEventListener("change", async () => {
    rule.enabled = enabled.checked;
    await savePrefs();
  });

  const remove = el("button", { class: "btn btn-ghost btn-small", type: "button" }, ["Remove"]);
  remove.addEventListener("click", async () => {
    prefs.rules = prefs.rules.filter((r) => r.id !== rule.id);
    await savePrefs();
  });

  const typeLabel = rule.matchType === "word" ? "word" : rule.matchType;
  return el("div", { class: "rule-row" + (rule.enabled ? "" : " rule-off") }, [
    enabled,
    el("span", { class: "rule-term" }, [rule.term]),
    el("span", { class: "rule-type" }, [typeLabel + (rule.group ? ` · ${rule.group}` : "")]),
    remove,
  ]);
}

function filtersSection(): HTMLElement {
  const input = el("input", { type: "text", placeholder: "word or phrase to filter…", maxlength: "200" }) as HTMLInputElement;
  const typeSel = el("select", { "aria-label": "Match type" }) as HTMLSelectElement;
  for (const [value, label] of [
    ["word", "whole word"],
    ["phrase", "phrase"],
    ["substring", "anywhere in text"],
  ] as const) {
    typeSel.append(el("option", { value }, [label]));
  }
  const addBtn = el("button", { class: "btn btn-primary", type: "button" }, ["Add filter"]);
  const add = async () => {
    const term = input.value.trim();
    if (!term) return;
    prefs.rules.push({
      id: randomId(),
      term,
      matchType: typeSel.value as MatchType,
      enabled: true,
    });
    input.value = "";
    await savePrefs();
  };
  addBtn.addEventListener("click", add);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") void add();
  });

  const presetButtons = PRESETS.map((preset) => {
    const applied = prefs.rules.some((r) => r.group === preset.id);
    const btn = el("button", { class: "chip" + (applied ? " chip-on" : ""), type: "button", title: preset.description }, [
      (applied ? "✓ " : "+ ") + preset.name,
    ]);
    btn.addEventListener("click", async () => {
      if (applied) {
        prefs.rules = prefs.rules.filter((r) => r.group !== preset.id);
      } else {
        const existing = new Set(prefs.rules.map((r) => r.term.toLowerCase() + "|" + r.matchType));
        for (const t of preset.terms) {
          const matchType: MatchType = t.matchType ?? "word";
          if (existing.has(t.term.toLowerCase() + "|" + matchType)) continue;
          prefs.rules.push({ id: randomId(), term: t.term, matchType, enabled: true, group: preset.id });
        }
      }
      await savePrefs();
    });
    return btn;
  });

  return section(
    "Filters",
    "Presets add editable starter terms — review them and remove any that don't apply to you. You never have to explain why a term is on your list.",
    [
      el("div", { class: "chips" }, presetButtons),
      el("div", { class: "add-row" }, [input, typeSel, addBtn]),
      el("div", { class: "rules" }, prefs.rules.length ? prefs.rules.map(ruleRow) : [el("p", { class: "hint" }, ["No filters yet."])]),
    ],
  );
}

// ---------- behavior ----------

function behaviorSection(): HTMLElement {
  const modeWrap = el("div", { class: "radio-row" });
  for (const [value, label, desc] of [
    ["placeholder", "Cover with placeholder", "matched cards are covered; you can reveal any item"],
    ["hide", "Remove entirely", "matched cards are removed from the page"],
  ] as const) {
    const radio = el("input", { type: "radio", name: "mode", value }) as HTMLInputElement;
    radio.checked = prefs.mode === value;
    radio.addEventListener("change", async () => {
      prefs.mode = value;
      await savePrefs();
    });
    modeWrap.append(el("label", { class: "radio" }, [radio, el("span", {}, [el("strong", {}, [label]), el("small", {}, [" — " + desc])])]));
  }

  const pause = el("input", { type: "checkbox" }) as HTMLInputElement;
  pause.checked = prefs.paused;
  pause.addEventListener("change", async () => {
    prefs.paused = pause.checked;
    await savePrefs();
  });

  return section("Behavior", "How matching recommendations are handled.", [
    modeWrap,
    el("label", { class: "switch" }, [pause, "Pause all filtering"]),
  ]);
}

// ---------- preview ----------

function previewSection(): HTMLElement {
  const matcher = compileMatcher(prefs.rules);
  const grid = el("div", { class: "preview-grid" });
  for (const card of SAMPLE_CARDS.slice(0, 8)) {
    const hit = matcher.match(`${card.title} ${card.source}`);
    const node = el("div", { class: "preview-card" + (hit ? " preview-hit" : "") }, [
      el("div", { class: "preview-thumb" }),
      el("div", { class: "preview-title" }, [card.title]),
      el("div", { class: "preview-meta" }, [`${card.source} · ${card.meta}`]),
    ]);
    if (hit && !prefs.paused) {
      node.append(el("div", { class: "preview-cover" }, [prefs.mode === "hide" ? "removed" : "Hidden by recreg"]));
    }
    grid.append(node);
  }
  return section("Preview", "Sample recommendations filtered with your current rules.", [grid]);
}

// ---------- export / import ----------

function dataSection(): HTMLElement {
  const exportBtn = el("button", { class: "btn", type: "button" }, ["Export filters"]);
  exportBtn.addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(prefs, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = el("a", { href: url, download: "recreg-preferences.json" });
    a.click();
    URL.revokeObjectURL(url);
  });

  const importInput = el("input", { type: "file", accept: "application/json", class: "visually-hidden", id: "import-file" }) as HTMLInputElement;
  const importBtn = el("button", { class: "btn", type: "button" }, ["Import filters"]);
  importBtn.addEventListener("click", () => importInput.click());
  const note = el("p", { class: "hint" });
  importInput.addEventListener("change", async () => {
    const file = importInput.files?.[0];
    if (!file) return;
    if (file.size > 1024 * 1024) {
      note.textContent = "Import rejected: file too large.";
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      note.textContent = "Import rejected: not valid JSON.";
      return;
    }
    const validated = validatePreferences(parsed);
    if (!validated) {
      note.textContent = "Import rejected: not a recreg preferences file.";
      return;
    }
    // Imports replace rules/mode but keep this browser's site enablement
    // (permissions don't travel with a JSON file).
    prefs = { ...validated, sites: prefs.sites };
    note.textContent = "Imported.";
    await savePrefs();
  });

  return section(
    "Your data",
    "Everything is stored locally in this browser. Nothing is sent anywhere — recreg has no servers and requests no network access.",
    [el("div", { class: "popup-actions" }, [exportBtn, importBtn, importInput]), note],
  );
}

// ---------- render ----------

// ---------- done ----------

function doneFooter(): HTMLElement {
  // Settings save as they change; Done just closes the page so setup has a
  // clear end instead of trailing off.
  const done = el("button", { class: "btn btn-primary btn-done", type: "button" }, ["Done"]);
  done.addEventListener("click", async () => {
    try {
      const tab = await chrome.tabs.getCurrent();
      if (tab?.id !== undefined) {
        await chrome.tabs.remove(tab.id);
        return;
      }
    } catch {
      // getCurrent is unavailable in some contexts; fall through.
    }
    window.close();
  });
  return el("div", { class: "done-row" }, [
    el("span", { class: "hint" }, ["Changes are saved automatically."]),
    done,
  ]);
}

function render(): void {
  clear(app);
  app.append(
    el("header", { class: "page-head" }, [
      el("h1", {}, ["recreg settings"]),
      el("p", { class: "tagline" }, ["Interacting with content is not consent to future recommendations."]),
    ]),
    sitesSection(),
    filtersSection(),
    behaviorSection(),
    previewSection(),
    dataSection(),
    doneFooter(),
  );
}

void loadPrefs().then(render);
