import { describe, it, expect } from "vitest";
import { compileMatcher, normalize, escapeRegex } from "../src/engine/matcher";
import type { Rule } from "../src/engine/prefs";

function rule(term: string, overrides: Partial<Rule> = {}): Rule {
  return { id: term, term, matchType: "word", enabled: true, ...overrides };
}

describe("normalize", () => {
  it("lowercases, NFKC-normalizes, collapses whitespace", () => {
    expect(normalize("  Ｈello   WORLD ")).toBe("hello world");
    expect(normalize("Café")).toBe("café");
  });
});

describe("word matching", () => {
  const m = compileMatcher([rule("bet")]);
  it("matches whole words only", () => {
    expect(m.match("place a bet this weekend")).toBeTruthy();
    expect(m.match("BET on this")).toBeTruthy();
    expect(m.match("alphabet soup recipe")).toBeNull();
    expect(m.match("better living")).toBeNull();
    expect(m.match("best bets for the weekend")).toBeNull(); // plural is a different word
  });
  it("treats punctuation as boundaries", () => {
    expect(m.match("Win big! Bet, today.")).toBeTruthy();
    expect(m.match("(bet)")).toBeTruthy();
  });
  it("reports which rule matched", () => {
    expect(m.match("place your bet")).toEqual({ ruleId: "bet", term: "bet" });
  });
});

describe("phrase matching", () => {
  const m = compileMatcher([rule("buy now", { matchType: "phrase" })]);
  it("matches across flexible whitespace", () => {
    expect(m.match("BUY   NOW and save")).toBeTruthy();
    expect(m.match("buy\nnow")).toBeTruthy();
  });
  it("does not match partial words", () => {
    expect(m.match("buy nowhere")).toBeNull();
    expect(m.match("buyback now")).toBeNull();
  });
});

describe("substring matching", () => {
  const m = compileMatcher([rule("% off", { matchType: "substring" })]);
  it("matches anywhere", () => {
    expect(m.match("50% off everything")).toBeTruthy();
    expect(m.match("nothing here")).toBeNull();
  });
});

describe("user terms are literals, never regex", () => {
  it("regex metacharacters are escaped", () => {
    const m = compileMatcher([rule("(a+)+b")]);
    expect(m.match("literally (a+)+b here")).toBeTruthy();
    expect(m.match("aaaab")).toBeNull();
  });
  it("hostile patterns do not throw or hang", () => {
    const evil = "((((((((((.*)*)*)*)*)*)*)*)*)*$";
    const m = compileMatcher([rule(evil, { matchType: "substring" })]);
    const start = Date.now();
    expect(m.match("a".repeat(5000))).toBeNull();
    expect(Date.now() - start).toBeLessThan(200);
  });
});

describe("rule filtering", () => {
  it("skips disabled rules", () => {
    const m = compileMatcher([rule("bet", { enabled: false })]);
    expect(m.ruleCount).toBe(0);
    expect(m.match("bet")).toBeNull();
  });
  it("applies site scoping", () => {
    const rules = [rule("bet", { sites: ["youtube"] })];
    expect(compileMatcher(rules, "youtube").match("bet")).toBeTruthy();
    expect(compileMatcher(rules, "reddit").match("bet")).toBeNull();
    // No siteId = match everywhere (used by preview/demo)
    expect(compileMatcher(rules).match("bet")).toBeTruthy();
  });
  it("empty ruleset matches nothing", () => {
    expect(compileMatcher([]).match("anything at all")).toBeNull();
  });
});

describe("unicode terms", () => {
  it("matches non-ASCII words with boundaries", () => {
    const m = compileMatcher([rule("пауки")]);
    expect(m.match("огромные ПАУКИ в доме")).toBeTruthy();
    expect(m.match("паукипаутина")).toBeNull();
  });
});

describe("escapeRegex", () => {
  it("escapes all metacharacters", () => {
    const s = ".*+?^${}()|[]\\";
    expect(new RegExp("^" + escapeRegex(s) + "$").test(s)).toBe(true);
  });
});

describe("performance sanity", () => {
  it("handles 500 rules x 1000 cards quickly", () => {
    const rules = Array.from({ length: 500 }, (_, i) => rule(`uniqueterm${i}`));
    const m = compileMatcher(rules);
    const start = Date.now();
    for (let i = 0; i < 1000; i++) {
      m.match(`Some fairly typical recommendation card title number ${i} with a channel name`);
    }
    expect(Date.now() - start).toBeLessThan(2000);
  });
});
