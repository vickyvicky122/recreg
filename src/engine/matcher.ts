// recreg filter engine — pure functions only.
// No DOM access, no browser APIs, no I/O. Input: card text. Output: match.
// This file is the auditable heart of the extension.

import type { Rule } from "./prefs";

export interface MatchHit {
  ruleId: string;
  term: string;
}

export interface Matcher {
  /** Number of rules active in this matcher. */
  ruleCount: number;
  /** Returns the first matching rule for the given text, or null. */
  match(text: string): MatchHit | null;
}

/** Unicode-normalize, lowercase, collapse whitespace. */
export function normalize(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Escape regex metacharacters so user terms are always treated as literals.
 * A term like "(a+)+b" must never become regex source (ReDoS / syntax error).
 */
export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Word/phrase boundaries: anything that is not a letter or digit, or the
// start/end of the text. Unicode-aware so terms work beyond ASCII.
const BOUNDARY_BEFORE = "(?<=^|[^\\p{L}\\p{N}])";
const BOUNDARY_AFTER = "(?=$|[^\\p{L}\\p{N}])";

interface CompiledRule {
  rule: Rule;
  regex: RegExp | null; // word/phrase rules
  needle: string | null; // substring rules
}

/**
 * Compile enabled rules (optionally scoped to one site) into a matcher.
 * Compilation happens once per preference change, not per card.
 */
export function compileMatcher(rules: Rule[], siteId?: string): Matcher {
  const compiled: CompiledRule[] = [];

  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (siteId && rule.sites && rule.sites.length > 0 && !rule.sites.includes(siteId)) continue;
    const term = normalize(rule.term);
    if (!term) continue;

    if (rule.matchType === "substring") {
      compiled.push({ rule, regex: null, needle: term });
    } else {
      // "word" and "phrase": boundary-delimited; internal whitespace in
      // phrases matches any whitespace run.
      const body = term.split(" ").map(escapeRegex).join("\\s+");
      compiled.push({
        rule,
        regex: new RegExp(BOUNDARY_BEFORE + body + BOUNDARY_AFTER, "u"),
        needle: null,
      });
    }
  }

  return {
    ruleCount: compiled.length,
    match(text: string): MatchHit | null {
      if (compiled.length === 0) return null;
      const t = normalize(text);
      if (!t) return null;
      for (const c of compiled) {
        if (c.needle !== null) {
          if (t.includes(c.needle)) return { ruleId: c.rule.id, term: c.rule.term };
        } else if (c.regex !== null && c.regex.test(t)) {
          return { ruleId: c.rule.id, term: c.rule.term };
        }
      }
      return null;
    },
  };
}
