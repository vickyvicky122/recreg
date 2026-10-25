// Landing-page demo for the pink design (frontend/demo.html). Same engine the
// extension ships; cards and chips are built as DOM nodes, never HTML strings.

import { compileMatcher } from "../engine/matcher";
import { PRESETS } from "../engine/presets";
import { randomId, type Rule, type MatchType } from "../engine/prefs";
import { SAMPLE_CARDS } from "../shared/samples";

const grid = document.getElementById("demo-grid") as HTMLElement;
const input = document.getElementById("demo-input") as HTMLInputElement;
const addBtn = document.getElementById("demo-add") as HTMLButtonElement;
const chips = document.getElementById("demo-chips") as HTMLElement;
const wordsWrap = document.getElementById("demo-words") as HTMLElement;
const count = document.getElementById("demo-count") as HTMLElement;
const niOption = document.getElementById("demo-ni") as HTMLInputElement;

// Per-card cover images (real YouTube thumbnails, bundled locally so the
// CSP's img-src 'self' holds), numbered in SAMPLE_CARDS order.
function thumbSrc(index: number): string {
  return `assets/thumbs/${String(index + 1).padStart(2, "0")}.jpg`;
}

let rules: Rule[] = [];
const revealed = new Set<number>();
// Cards where the simulated "Not interested on YouTube" was pressed.
const sent = new Set<number>();

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
    const btn = el("button", { class: "chip" + (applied ? " on" : ""), type: "button", title: preset.description }, [
      (applied ? "✓ " : "") + preset.name,
    ]);
    btn.addEventListener("click", () => {
      if (applied) rules = rules.filter((r) => r.group !== preset.id);
      else for (const t of preset.terms) addTerm(t.term, t.matchType, preset.id);
      revealed.clear();
      sent.clear();
      render();
    });
    chips.append(btn);
  }
}

function renderWords(): void {
  clear(wordsWrap);
  const own = rules.filter((r) => !r.group);
  if (own.length === 0) return;
  wordsWrap.append(el("span", { class: "words-label" }, ["Your words:"]));
  for (const rule of own) {
    const tag = el("button", { class: "word", type: "button", "aria-label": "Remove this filter word" }, [rule.term + " ×"]);
    tag.addEventListener("click", () => {
      rules = rules.filter((r) => r.id !== rule.id);
      revealed.clear();
      sent.clear();
      render();
    });
    wordsWrap.append(tag);
  }
}

function renderGrid(): void {
  clear(grid);
  const matcher = compileMatcher(rules);
  let hidden = 0;
  SAMPLE_CARDS.forEach((card, index) => {
    const covered = matcher.match(`${card.title} ${card.source}`) && !revealed.has(index);
    if (covered) {
      hidden++;
      if (sent.has(index)) {
        // What YouTube shows after Not interested: its own notice, with its
        // own Undo and Tell us why. recreg's cover is gone at this point.
        const undo = el("button", { class: "show", type: "button" }, ["Undo"]);
        undo.addEventListener("click", () => {
          sent.delete(index);
          revealed.add(index);
          render();
        });
        grid.append(
          el("div", { class: "card yt-notice" }, [
            el("div", { class: "title" }, ["Video removed"]),
            el("div", { class: "actions" }, [undo, el("span", { class: "yt-why" }, ["Tell us why"])]),
            el("span", { class: "sim-tag" }, ["Simulated YouTube"]),
          ]),
        );
        return;
      }
      const actions = el("div", { class: "actions" });
      const show = el("button", { class: "show", type: "button" }, ["Show"]);
      show.addEventListener("click", () => {
        revealed.add(index);
        render();
      });
      actions.append(show);
      if (niOption.checked) {
        const ni = el("button", { class: "ni", type: "button" }, ["Not interested on YouTube"]);
        ni.addEventListener("click", () => {
          sent.add(index);
          render();
        });
        actions.append(ni);
      }
      grid.append(
        el("div", { class: "card covered" }, [
          el("div", { class: "thumb" }),
          el("div", { class: "title" }, ["Hidden by recreg"]),
          actions,
          ...(niOption.checked ? [el("span", { class: "sim-tag" }, ["Simulated"])] : []),
        ]),
      );
      return;
    }
    const thumb = el("div", { class: "thumb" }, [
      el("img", { src: thumbSrc(index), alt: "", loading: "lazy" }),
    ]);
    grid.append(
      el("div", { class: "card" }, [
        thumb,
        el("div", { class: "title" }, [card.title]),
        el("div", { class: "meta" }, [`${card.source} · ${card.meta}`]),
      ]),
    );
  });
  count.textContent = `${rules.length} filter${rules.length === 1 ? "" : "s"} active · ${hidden} of ${SAMPLE_CARDS.length} recommendations hidden.`;
}

function render(): void {
  renderChips();
  renderWords();
  renderGrid();
}

function submit(): void {
  addTerm(input.value);
  input.value = "";
  revealed.clear();
  sent.clear();
  render();
}

niOption.addEventListener("change", () => {
  sent.clear();
  render();
});
addBtn.addEventListener("click", submit);
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter") submit();
});

render();
