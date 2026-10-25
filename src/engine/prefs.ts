// Preference model + strict validation.
// Everything read from storage or an import file passes through
// validatePreferences() — unknown shapes are rejected or dropped, limits
// enforced, so malformed/hostile input can at worst become an empty ruleset.

export type MatchType = "word" | "phrase" | "substring";
export type FilterMode = "placeholder" | "hide";

export interface Rule {
  id: string;
  term: string;
  matchType: MatchType;
  enabled: boolean;
  /** Adapter ids this rule applies to; absent/empty = all sites. */
  sites?: string[];
  /** Group this rule belongs to, for bulk management: a preset id
   *  ("gambling") or the id of a user-created Group. */
  group?: string;
}

/** A user-created bundle of rules ("study", "diet"). Toggling it enables or
 *  disables its rules in one go; the words themselves are kept. */
export interface Group {
  id: string;
  name: string;
}

export interface SiteSettings {
  enabled: boolean;
  /** Hide whole recommendation sections instead of individual cards. */
  hideSections?: boolean;
  /** Show a "Not interested on <platform>" button on covered cards. The
   *  signal is only sent when the user presses it. Opt-in; off by default. */
  feedbackButton?: boolean;
  /** Automatically send the platform's "not interested" for every matched
   *  card, so the platform's own notice (Undo / Tell us why) replaces the
   *  recreg cover. Opt-in; off by default. */
  autoFeedback?: boolean;
}

export interface Preferences {
  schemaVersion: 1;
  paused: boolean;
  mode: FilterMode;
  sites: Record<string, SiteSettings>;
  rules: Rule[];
  groups: Group[];
}

export const LIMITS = {
  maxRules: 1000,
  maxTermLength: 200,
  maxIdLength: 64,
  maxSiteId: 50,
  maxSitesPerRule: 20,
  maxGroups: 50,
  maxGroupName: 40,
} as const;

export const DEFAULT_PREFS: Preferences = {
  schemaVersion: 1,
  paused: false,
  mode: "placeholder",
  sites: {},
  rules: [],
  groups: [],
};

export function randomId(): string {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  } catch {
    // fall through
  }
  return "r-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Strictly validate untrusted input (storage reads, imports) into a
 * Preferences object. Returns null if the overall shape is unusable;
 * individually invalid rules/sites are silently dropped.
 */
export function validatePreferences(input: unknown): Preferences | null {
  if (!isRecord(input)) return null;
  if (input.schemaVersion !== 1) return null;

  const out: Preferences = {
    schemaVersion: 1,
    paused: input.paused === true,
    mode: input.mode === "hide" ? "hide" : "placeholder",
    sites: {},
    rules: [],
    groups: [],
  };

  if (Array.isArray(input.groups)) {
    const seen = new Set<string>();
    for (const raw of input.groups.slice(0, LIMITS.maxGroups)) {
      if (!isRecord(raw)) continue;
      if (typeof raw.id !== "string" || raw.id.length === 0 || raw.id.length > LIMITS.maxIdLength) continue;
      if (typeof raw.name !== "string") continue;
      const name = raw.name.trim();
      if (!name || name.length > LIMITS.maxGroupName) continue;
      if (seen.has(raw.id)) continue;
      seen.add(raw.id);
      out.groups.push({ id: raw.id, name });
    }
  }

  if (isRecord(input.sites)) {
    for (const [key, value] of Object.entries(input.sites)) {
      if (key.length === 0 || key.length > LIMITS.maxSiteId) continue;
      if (!isRecord(value)) continue;
      out.sites[key] = {
        enabled: value.enabled === true,
        hideSections: value.hideSections === true,
        feedbackButton: value.feedbackButton === true,
        autoFeedback: value.autoFeedback === true,
      };
    }
  }

  if (Array.isArray(input.rules)) {
    for (const raw of input.rules.slice(0, LIMITS.maxRules)) {
      if (!isRecord(raw)) continue;
      if (typeof raw.term !== "string") continue;
      const term = raw.term.trim();
      if (!term || term.length > LIMITS.maxTermLength) continue;
      const matchType: MatchType =
        raw.matchType === "phrase" || raw.matchType === "substring" ? raw.matchType : "word";
      const rule: Rule = {
        id:
          typeof raw.id === "string" && raw.id.length > 0 && raw.id.length <= LIMITS.maxIdLength
            ? raw.id
            : randomId(),
        term,
        matchType,
        enabled: raw.enabled !== false,
      };
      if (Array.isArray(raw.sites)) {
        const sites = raw.sites
          .filter((s): s is string => typeof s === "string" && s.length > 0 && s.length <= LIMITS.maxSiteId)
          .slice(0, LIMITS.maxSitesPerRule);
        if (sites.length > 0) rule.sites = sites;
      }
      if (typeof raw.group === "string" && raw.group.length > 0 && raw.group.length <= LIMITS.maxIdLength) {
        rule.group = raw.group;
      }
      out.rules.push(rule);
    }
  }

  return out;
}
