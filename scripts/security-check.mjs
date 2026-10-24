// CI gate: the "no network, no HTML injection, no eval" guarantees must not
// erode quietly. Fails the build if forbidden patterns appear in src/.

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const FORBIDDEN = [
  { re: /\bfetch\s*\(/, why: "network access (fetch)" },
  { re: /XMLHttpRequest/, why: "network access (XHR)" },
  { re: /\bWebSocket\b/, why: "network access (WebSocket)" },
  { re: /navigator\.sendBeacon/, why: "network access (sendBeacon)" },
  { re: /\binnerHTML\b/, why: "HTML injection sink (innerHTML)" },
  { re: /\bouterHTML\s*=/, why: "HTML injection sink (outerHTML)" },
  { re: /insertAdjacentHTML/, why: "HTML injection sink (insertAdjacentHTML)" },
  { re: /document\.write/, why: "HTML injection sink (document.write)" },
  { re: /\beval\s*\(/, why: "dynamic code (eval)" },
  { re: /new\s+Function\s*\(/, why: "dynamic code (new Function)" },
];

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (/\.(ts|tsx|mts|js|mjs)$/.test(entry.name)) yield path;
  }
}

let failures = 0;
for await (const file of walk("src")) {
  const text = await readFile(file, "utf8");
  const lines = text.split("\n");
  for (const { re, why } of FORBIDDEN) {
    lines.forEach((line, i) => {
      if (re.test(line)) {
        console.error(`FORBIDDEN ${file}:${i + 1} — ${why}\n  ${line.trim()}`);
        failures++;
      }
    });
  }
}

if (failures > 0) {
  console.error(`\nsecurity check failed: ${failures} forbidden pattern(s).`);
  process.exit(1);
}
console.log("security check passed: no network calls, HTML sinks, or dynamic code in src/.");
