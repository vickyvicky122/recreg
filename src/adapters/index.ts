// Supported sites. Selectors include fallbacks for recent DOM generations;
// they WILL drift as sites redesign — the health check surfaces that in the
// UI instead of failing silently. Update here, re-release.

import type { SiteAdapter } from "./schema";
export { adapterForHost, validateAdapter } from "./schema";
export type { SiteAdapter, Region, TextSource } from "./schema";

const youtube: SiteAdapter = {
  id: "youtube",
  name: "YouTube",
  matches: ["*://*.youtube.com/*"],
  hosts: ["youtube.com"],
  healthCheck: "ytd-app",
  regions: [
    {
      id: "home-feed",
      containers: ["ytd-rich-grid-renderer", "ytd-browse[page-subtype='home']"],
      cards: ["ytd-rich-item-renderer"],
      text: [
        { selector: "#video-title" },
        { selector: "#video-title-link", attr: "aria-label" },
        { selector: "a[href^='/watch'][aria-label]", attr: "aria-label" },
        { selector: "yt-lockup-metadata-view-model h3" },
        { selector: "ytd-channel-name" },
        { selector: ".yt-core-attributed-string" },
      ],
    },
    {
      id: "watch-related",
      containers: ["#related", "ytd-watch-next-secondary-results-renderer"],
      cards: ["ytd-compact-video-renderer", "yt-lockup-view-model", "ytd-rich-item-renderer"],
      text: [
        { selector: "#video-title" },
        { selector: "#video-title", attr: "title" },
        { selector: "h3" },
        { selector: "a[href^='/watch'][aria-label]", attr: "aria-label" },
        { selector: "ytd-channel-name" },
      ],
    },
    {
      id: "shorts-shelf",
      containers: ["ytd-rich-shelf-renderer", "ytd-reel-shelf-renderer"],
      cards: ["ytd-rich-item-renderer", "ytm-shorts-lockup-view-model-v2", "ytm-shorts-lockup-view-model"],
      text: [
        { selector: "#video-title" },
        { selector: "h3" },
        { selector: "a[aria-label]", attr: "aria-label" },
        { selector: ".shortsLockupViewModelHostMetadataTitle" },
      ],
    },
  ],
};

const reddit: SiteAdapter = {
  id: "reddit",
  name: "Reddit",
  matches: ["*://*.reddit.com/*"],
  hosts: ["reddit.com"],
  healthCheck: "shreddit-app, #siteTable, .reddit-infobar, body.listing-page",
  regions: [
    {
      id: "feed",
      containers: ["shreddit-feed", "main"],
      cards: ["shreddit-post", "article"],
      text: [
        { selector: "", attr: "post-title" },
        { selector: "a[slot='title']" },
        { selector: "[slot='title']" },
        { selector: "h3" },
        { selector: "faceplate-screen-reader-content" },
      ],
    },
    {
      id: "old-reddit-feed",
      containers: ["#siteTable"],
      cards: [".thing.link"],
      text: [{ selector: "a.title" }, { selector: ".subreddit" }],
    },
  ],
};

const pinterest: SiteAdapter = {
  id: "pinterest",
  name: "Pinterest",
  matches: ["*://*.pinterest.com/*"],
  hosts: ["pinterest.com"],
  healthCheck: "#__PWS_ROOT__, [data-test-id='homefeed-feed'], [role='main']",
  regions: [
    {
      id: "feed",
      containers: ["[role='main']", "[data-test-id='homefeed-feed']"],
      cards: ["[data-test-id='pin']", "[data-grid-item='true']"],
      text: [
        { selector: "a[aria-label]", attr: "aria-label" },
        { selector: "[data-test-id='pinrep-title']" },
        { selector: "[data-test-id='pin-title']" },
        { selector: "img", attr: "alt" },
        { selector: "h3" },
      ],
    },
  ],
};

export const ADAPTERS: SiteAdapter[] = [youtube, reddit, pinterest];
