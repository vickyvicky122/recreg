// Site adapter schema. Adapters are DATA, not code: selectors and text
// extraction paths only. A bad adapter can mis-select elements; it can
// never execute logic. Keep it that way.

export interface TextSource {
  /** CSS selector within the card. Empty string means the card element itself. */
  selector: string;
  /** Attribute to read; absent = textContent. */
  attr?: string;
}

export interface Region {
  id: string;
  /** Selectors for the recommendation section(s) this region covers. */
  containers: string[];
  /** Selectors for individual recommendation cards within a container. */
  cards: string[];
  /** Where to read the card's visible text from. */
  text: TextSource[];
}

export interface FeedbackAction {
  /** Selectors (within the card) for the card's action-menu button. */
  menuButton: string[];
  /** Selectors for the menu items in the page-level popup that button opens. */
  menuItems: string[];
  /** Menu-item labels (lowercased, trimmed) that mean "not interested".
   *  Compared by exact equality so a partial match can never click the
   *  wrong action. */
  itemLabels: string[];
}

export interface SiteAdapter {
  id: string;
  name: string;
  /** Host permission patterns (manifest optional_host_permissions). */
  matches: string[];
  /** Host suffixes for runtime host matching, e.g. "youtube.com". */
  hosts: string[];
  /** Selector that must exist on a supported page; missing = adapter broken. */
  healthCheck: string;
  /** Recommendation regions. Search-results areas are deliberately absent:
   *  deliberate searches pass through by default. */
  regions: Region[];
  /** How to tell the platform "not interested" for a card, if it supports
   *  that. Absent = the site offers no feedback action. */
  feedback?: FeedbackAction;
}

export function validateAdapter(a: SiteAdapter): string[] {
  const errors: string[] = [];
  const nonEmpty = (s: unknown): s is string => typeof s === "string" && s.trim().length > 0;

  if (!nonEmpty(a.id)) errors.push("adapter id missing");
  if (!nonEmpty(a.name)) errors.push(`${a.id}: name missing`);
  if (!Array.isArray(a.matches) || a.matches.length === 0) errors.push(`${a.id}: matches missing`);
  for (const m of a.matches ?? []) {
    if (!/^\*:\/\/[a-z0-9*.-]+\/\*$/.test(m)) errors.push(`${a.id}: suspicious match pattern "${m}"`);
  }
  if (!Array.isArray(a.hosts) || a.hosts.length === 0) errors.push(`${a.id}: hosts missing`);
  if (!nonEmpty(a.healthCheck)) errors.push(`${a.id}: healthCheck missing`);
  if (!Array.isArray(a.regions) || a.regions.length === 0) errors.push(`${a.id}: regions missing`);

  for (const r of a.regions ?? []) {
    if (!nonEmpty(r.id)) errors.push(`${a.id}: region id missing`);
    if (!Array.isArray(r.containers) || r.containers.length === 0 || !r.containers.every(nonEmpty)) {
      errors.push(`${a.id}/${r.id}: containers invalid`);
    }
    if (!Array.isArray(r.cards) || r.cards.length === 0 || !r.cards.every(nonEmpty)) {
      errors.push(`${a.id}/${r.id}: cards invalid`);
    }
    if (!Array.isArray(r.text) || r.text.length === 0) {
      errors.push(`${a.id}/${r.id}: text sources missing`);
    }
    for (const t of r.text ?? []) {
      if (typeof t.selector !== "string") errors.push(`${a.id}/${r.id}: text selector invalid`);
      if (t.attr !== undefined && !nonEmpty(t.attr)) errors.push(`${a.id}/${r.id}: text attr invalid`);
    }
  }

  if (a.feedback !== undefined) {
    const f = a.feedback;
    for (const key of ["menuButton", "menuItems", "itemLabels"] as const) {
      const list = f?.[key];
      if (!Array.isArray(list) || list.length === 0 || !list.every(nonEmpty)) {
        errors.push(`${a.id}: feedback.${key} invalid`);
      }
    }
    for (const label of f?.itemLabels ?? []) {
      if (typeof label === "string" && label !== label.trim().toLowerCase()) {
        errors.push(`${a.id}: feedback label "${label}" must be lowercased and trimmed`);
      }
    }
  }
  return errors;
}

export function adapterForHost(adapters: SiteAdapter[], hostname: string): SiteAdapter | null {
  const host = hostname.toLowerCase();
  for (const a of adapters) {
    for (const suffix of a.hosts) {
      if (host === suffix || host.endsWith("." + suffix)) return a;
    }
  }
  return null;
}
