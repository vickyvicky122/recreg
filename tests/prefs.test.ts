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
    expect(out!.sites["youtube"]).toEqual({ enabled: true, hideSections: false });
    expect(Object.keys(out!.sites)).toEqual(["youtube"]);
  });
});
