// Build: bundles the extension into extension/dist and the landing site into
// site/dist. Zero network access at runtime; everything is bundled.
// Usage: node build.mjs [ext|site|all]

import { build } from "esbuild";
import { mkdir, rm, copyFile, writeFile, readFile, readdir } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import { join } from "node:path";

const target = process.argv[2] ?? "all";

// ---------- minimal PNG writer (for extension icons; no dependencies) ----------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, pixelAt) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixelAt(x, y);
      const i = rowStart + 1 + x * 4;
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
      raw[i + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// Icon: dark rounded tile with three "feed card" bars; the middle one is
// shorter and accent-colored (the filtered card).
function iconPixel(size) {
  const BG = [27, 29, 35];
  const BAR = [232, 234, 237];
  const ACCENT = [139, 143, 240];
  const radius = size * 0.22;

  const inRounded = (x, y, x0, y0, x1, y1, r) => {
    if (x < x0 || x > x1 || y < y0 || y > y1) return false;
    const cx = Math.max(x0 + r, Math.min(x, x1 - r));
    const cy = Math.max(y0 + r, Math.min(y, y1 - r));
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r || (x >= x0 + r && x <= x1 - r) || (y >= y0 + r && y <= y1 - r);
  };

  const bars = [
    { y0: 0.2, y1: 0.33, x0: 0.2, x1: 0.8, color: BAR },
    { y0: 0.44, y1: 0.57, x0: 0.2, x1: 0.58, color: ACCENT },
    { y0: 0.68, y1: 0.81, x0: 0.2, x1: 0.8, color: BAR },
  ];

  return (x, y) => {
    if (!inRounded(x, y, 0, 0, size - 1, size - 1, radius)) return [0, 0, 0, 0];
    for (const b of bars) {
      const r = (size * (b.y1 - b.y0)) / 2;
      if (inRounded(x, y, size * b.x0, size * b.y0, size * b.x1, size * b.y1, r)) {
        return [...b.color, 255];
      }
    }
    return [...BG, 255];
  };
}

// ---------- minimal ZIP writer (stored entries; no dependencies) ----------

function zipEntries(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(0, 8); // method: stored
    local.writeUInt32LE(0, 10); // time/date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, nameBuf, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10); // method
    central.writeUInt32LE(0, 12); // time/date
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuf);

    offset += 30 + nameBuf.length + data.length;
  }

  const centralDir = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...localParts, centralDir, eocd]);
}

async function collectFiles(dir, prefix) {
  const entries = [];
  for (const item of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(dir, item.name);
    if (item.isDirectory()) {
      entries.push(...(await collectFiles(path, `${prefix}${item.name}/`)));
    } else {
      entries.push({ name: `${prefix}${item.name}`, data: await readFile(path) });
    }
  }
  return entries;
}

// ---------- builds ----------

async function buildExt() {
  await rm("extension/dist", { recursive: true, force: true });
  await mkdir("extension/dist/icons", { recursive: true });

  await build({
    entryPoints: {
      background: "src/extension/background.ts",
      content: "src/extension/content.ts",
      popup: "src/extension/popup.ts",
      options: "src/extension/options.ts",
    },
    bundle: true,
    format: "iife",
    outdir: "extension/dist",
    target: ["chrome120"],
    logLevel: "info",
  });

  for (const f of ["manifest.json", "popup.html", "options.html", "ui.css"]) {
    await copyFile(`src/extension/${f}`, `extension/dist/${f}`);
  }
  for (const size of [16, 32, 48, 128]) {
    await writeFile(`extension/dist/icons/icon${size}.png`, encodePng(size, iconPixel(size)));
  }
  console.log("extension → extension/dist (load unpacked from there)");
}

async function buildSite() {
  // The site ships a downloadable zip of the extension, so build that first.
  await buildExt();

  await rm("site/dist", { recursive: true, force: true });
  await mkdir("site/dist", { recursive: true });

  const manifest = JSON.parse(await readFile("src/extension/manifest.json", "utf8"));
  const files = await collectFiles("extension/dist", "recreg-extension/");
  await writeFile("site/dist/recreg-extension.zip", zipEntries(files));
  console.log(`site/dist/recreg-extension.zip (v${manifest.version}, ${files.length} files)`);

  await build({
    entryPoints: { demo: "src/site/demo.ts" },
    bundle: true,
    format: "iife",
    outdir: "site/dist",
    target: ["es2020"],
    minify: true,
    logLevel: "info",
  });

  for (const f of ["index.html", "style.css"]) {
    await copyFile(`site/${f}`, `site/dist/${f}`);
  }
  console.log("site → site/dist (Vercel output directory)");
}

if (target === "ext") await buildExt();
if (target === "site" || target === "all") await buildSite(); // site build includes the extension
