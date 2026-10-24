// Landing-page demo: the same engine the extension ships, running on sample
// cards. No HTML string sinks — all strings land as text nodes.

import { compileMatcher } from "../engine/matcher";
import { PRESETS } from "../engine/presets";
import { randomId, type Rule, type MatchType } from "../engine/prefs";
import { SAMPLE_CARDS } from "../shared/samples";

const grid = document.getElementById("demo-grid") as HTMLElement;
const input = document.getElementById("demo-input") as HTMLInputElement;
const addBtn = document.getElementById("demo-add") as HTMLButtonElement;
const chips = document.getElementById("demo-chips") as HTMLElement;
const activeWrap = document.getElementById("demo-active") as HTMLElement;

let rules: Rule[] = [];
const revealedCards = new Set<number>();

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  children: Array<Node | string> = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else node.setAttribute(k, v);
  }
  node.append(...children);
  return node;
}

function clear(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function addTerm(term: string, matchType?: MatchType, group?: string): void {
  const t = term.trim();
  if (!t) return;
  if (rules.some((r) => r.term.toLowerCase() === t.toLowerCase())) return;
  const rule: Rule = {
    id: randomId(),
    term: t,
    matchType: matchType ?? (t.includes(" ") ? "phrase" : "word"),
    enabled: true,
  };
  if (group) rule.group = group;
  rules.push(rule);
}

function renderChips(): void {
  clear(chips);
  for (const preset of PRESETS) {
    const applied = rules.some((r) => r.group === preset.id);
    const btn = el("button", { class: "chip" + (applied ? " chip-on" : ""), type: "button", title: preset.description }, [
      (applied ? "✓ " : "+ ") + preset.name,
    ]);
    btn.addEventListener("click", () => {
      if (applied) {
        rules = rules.filter((r) => r.group !== preset.id);
      } else {
        for (const t of preset.terms) addTerm(t.term, t.matchType, preset.id);
      }
      render();
    });
    chips.append(btn);
  }
}

function renderActive(): void {
  clear(activeWrap);
  const own = rules.filter((r) => !r.group);
  if (own.length === 0) return;
  activeWrap.append(el("span", { class: "active-label" }, ["Your filters:"]));
  for (const rule of own) {
    const tag = el("button", { class: "tag", type: "button", title: "Remove filter" }, [rule.term + " ✕"]);
    tag.addEventListener("click", () => {
      rules = rules.filter((r) => r.id !== rule.id);
      render();
    });
    activeWrap.append(tag);
  }
}

function renderGrid(): void {
  clear(grid);
  const matcher = compileMatcher(rules);
  let hidden = 0;
  SAMPLE_CARDS.forEach((card, index) => {
    const hit = matcher.match(`${card.title} ${card.source}`);
    const node = el("div", { class: "demo-card" }, [
      el("div", { class: "thumb thumb-" + ((index % 6) + 1) }),
      el("div", { class: "card-title" }, [card.title]),
      el("div", { class: "card-meta" }, [`${card.source} · ${card.meta}`]),
    ]);
    if (hit && !revealedCards.has(index)) {
      hidden++;
      const reveal = el("button", { class: "btn btn-small", type: "button" }, ["Show"]);
      reveal.addEventListener("click", () => {
        revealedCards.add(index);
        render();
      });
      node.append(el("div", { class: "cover" }, [el("span", {}, ["Hidden by recreg"]), reveal]));
    }
    grid.append(node);
  });
  grid.append(
    el("p", { class: "demo-count" }, [
      rules.length === 0
        ? "No filters active — add one above."
        : `${rules.length} filter${rules.length === 1 ? "" : "s"} active · ${hidden} of ${SAMPLE_CARDS.length} recommendations hidden.`,
    ]),
  );
}

function render(): void {
  renderChips();
  renderActive();
  renderGrid();
}

addBtn.addEventListener("click", () => {
  addTerm(input.value);
  input.value = "";
  revealedCards.clear();
  render();
});
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    addTerm(input.value);
    input.value = "";
    revealedCards.clear();
    render();
  }
});

render();
