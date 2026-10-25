import { describe, it, expect } from "vitest";
import { ADAPTERS, adapterForHost, validateAdapter } from "../src/adapters";

describe("adapters", () => {
  it("all adapters pass schema validation", () => {
    for (const adapter of ADAPTERS) {
      expect(validateAdapter(adapter)).toEqual([]);
    }
  });

  it("adapter ids are unique", () => {
    const ids = ADAPTERS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("host matching is suffix-safe", () => {
    expect(adapterForHost(ADAPTERS, "www.youtube.com")?.id).toBe("youtube");
    expect(adapterForHost(ADAPTERS, "youtube.com")?.id).toBe("youtube");
    expect(adapterForHost(ADAPTERS, "m.youtube.com")?.id).toBe("youtube");
    expect(adapterForHost(ADAPTERS, "old.reddit.com")?.id).toBe("reddit");
    // Lookalike domains must NOT match.
    expect(adapterForHost(ADAPTERS, "evilyoutube.com")).toBeNull();
    expect(adapterForHost(ADAPTERS, "youtube.com.evil.net")).toBeNull();
  });

  it("rejects malformed feedback configs", () => {
    const base = ADAPTERS.find((a) => a.id === "youtube")!;
    const ok = { menuButton: ["b"], menuItems: ["x"], itemLabels: ["y"] };
    expect(validateAdapter({ ...base, feedback: { ...ok, menuButton: [] } })).toContain(
      "youtube: feedback.menuButton invalid",
    );
    expect(validateAdapter({ ...base, feedback: { ...ok, itemLabels: ["Not Interested"] } })).toContain(
      'youtube: feedback label "Not Interested" must be lowercased and trimmed',
    );
  });

  it("never lists the 'Tell us why' control as something to click", () => {
    const fb = ADAPTERS.find((a) => a.id === "youtube")!.feedback!;
    for (const label of [...fb.itemLabels]) {
      expect(label).not.toMatch(/tell us why|why/);
    }
  });

  it("match patterns stay scoped to their own domains", () => {
    for (const adapter of ADAPTERS) {
      for (const pattern of adapter.matches) {
        expect(pattern).not.toContain("<all_urls>");
        expect(pattern).toMatch(/^\*:\/\/\*\.[a-z0-9.-]+\/\*$/);
      }
    }
  });
});
