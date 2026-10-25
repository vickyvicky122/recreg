import { describe, it, expect } from "vitest";
import { validatePreferences, DEFAULT_PREFS, LIMITS } from "../src/engine/prefs";

describe("validatePreferences", () => {
  it("accepts a round-trip of defaults", () => {
    expect(validatePreferences(JSON.parse(JSON.stringify(DEFAULT_PREFS)))).toEqual(DEFAULT_PREFS);
  });

  it("rejects non-objects and wrong versions", () => {
    expect(validatePreferences(null)).toBeNull();
    expect(validatePreferences("x")).toBeNull();
    expect(validatePreferences([])).toBeNull();
    expect(validatePreferences({ schemaVersion: 2 })).toBeNull();
    expect(validatePreferences({})).toBeNull();
  });

  it("drops malformed rules, keeps valid ones", () => {
    const out = validatePreferences({
      schemaVersion: 1,
      rules: [
        { term: "ok" },
        { term: "" },
        { term: 42 },
        null,
        "string",
        { term: "x".repeat(LIMITS.maxTermLength + 1) },
        { term: "scoped", sites: ["youtube", 7, ""] },
      ],
    });
    expect(out).not.toBeNull();
    expect(out!.rules.map((r) => r.term)).toEqual(["ok", "scoped"]);
    expect(out!.rules[1]!.sites).toEqual(["youtube"]);
  });

  it("coerces unknown enum values to safe defaults", () => {
    const out = validatePreferences({
      schemaVersion: 1,
      mode: "explode",
      paused: "yes",
      rules: [{ term: "a", matchType: "regex", enabled: "nope" }],
    });
    expect(out!.mode).toBe("placeholder");
    expect(out!.paused).toBe(false);
    expect(out!.rules[0]!.matchType).toBe("word");
    expect(out!.rules[0]!.enabled).toBe(true);
  });

  it("enforces the rule count limit", () => {
    const rules = Array.from({ length: LIMITS.maxRules + 500 }, (_, i) => ({ term: `t${i}` }));
    const out = validatePreferences({ schemaVersion: 1, rules });
    expect(out!.rules.length).toBe(LIMITS.maxRules);
  });

  it("assigns ids when missing, trims terms, sanitizes sites map", () => {
    const out = validatePreferences({
      schemaVersion: 1,
      sites: { youtube: { enabled: true, hideSections: "x" }, "": { enabled: true }, bad: null },
      rules: [{ term: "  padded  " }],
    });
    expect(out!.rules[0]!.term).toBe("padded");
    expect(out!.rules[0]!.id.length).toBeGreaterThan(0);
    expect(out!.sites["youtube"]).toEqual({ enabled: true, hideSections: false, feedbackButton: false, autoFeedback: false });
    expect(Object.keys(out!.sites)).toEqual(["youtube"]);
  });

  it("feedbackButton is opt-in: only an explicit true survives", () => {
    const out = validatePreferences({
      schemaVersion: 1,
      sites: {
        youtube: { enabled: true, feedbackButton: true },
        reddit: { enabled: true, feedbackButton: "yes" },
      },
      rules: [],
    });
    expect(out!.sites["youtube"]!.feedbackButton).toBe(true);
    expect(out!.sites["reddit"]!.feedbackButton).toBe(false);
  });

  it("autoFeedback is opt-in: only an explicit true survives", () => {
    const out = validatePreferences({
      schemaVersion: 1,
      sites: {
        youtube: { enabled: true, autoFeedback: true },
        reddit: { enabled: true, autoFeedback: 1 },
      },
      rules: [],
    });
    expect(out!.sites["youtube"]!.autoFeedback).toBe(true);
    expect(out!.sites["reddit"]!.autoFeedback).toBe(false);
  });

  it("keeps valid user groups and drops malformed ones", () => {
    const out = validatePreferences({
      schemaVersion: 1,
      groups: [
        { id: "g1", name: "  study " },
        { id: "g1", name: "duplicate id" },
        { id: "g2", name: "" },
        { id: "", name: "no id" },
        { id: "g3", name: "x".repeat(LIMITS.maxGroupName + 1) },
        "junk",
        { id: "g4", name: "diet" },
      ],
      rules: [{ term: "exam", group: "g1" }],
    });
    expect(out!.groups).toEqual([
      { id: "g1", name: "study" },
      { id: "g4", name: "diet" },
    ]);
    expect(out!.rules[0]!.group).toBe("g1");
  });

  it("groups default to an empty list", () => {
    expect(validatePreferences({ schemaVersion: 1 })!.groups).toEqual([]);
  });
});
