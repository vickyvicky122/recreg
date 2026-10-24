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

  it("match patterns stay scoped to their own domains", () => {
    for (const adapter of ADAPTERS) {
      for (const pattern of adapter.matches) {
        expect(pattern).not.toContain("<all_urls>");
        expect(pattern).toMatch(/^\*:\/\/\*\.[a-z0-9.-]+\/\*$/);
      }
    }
  });
});
