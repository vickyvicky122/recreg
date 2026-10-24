// Build: bundles the extension into extension/dist and the landing site into
// site/dist. Zero network access at runtime; everything is bundled.
// Usage: node build.mjs [ext|site|all]

import { build } from "esbuild";
import { mkdir, rm, cp, copyFile, writeFile, readFile, readdir } from "node:fs/promises";
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
  // Rasterises frontend/favicon.svg (pink tile + "R") with no dependencies:
  // 64-unit design space, 4x4 supersampling for anti-aliasing.
  const TILE = [247, 193, 212];
  const INK = [107, 91, 97];
  const k = 0.7;
  const at = (x, y) => [9.6 + k * x, 9.6 + k * y];
  const arc = [];
  for (let i = 0; i <= 16; i++) {
    const t = -Math.PI / 2 + (Math.PI * i) / 16;
    arc.push(at(35 + 10.5 * Math.cos(t), 24.5 + 10.5 * Math.sin(t)));
  }
  const strokes = [
    [at(22, 50), at(22, 14), at(35, 14), ...arc, at(35, 35), at(22, 35)],
    [at(37, 41), at(45, 50)],
  ];
  const half = (4.2 * k) / 2;

  const distToSeg = (px, py, [ax, ay], [bx, by]) => {
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  };
  const inInk = (px, py) =>
    strokes.some((pts) => pts.some((p, i) => i > 0 && distToSeg(px, py, pts[i - 1], p) <= half));
  const inTile = (px, py) => {
    const x0 = 4, y0 = 4, x1 = 60, y1 = 60, r = 16;
    if (px < x0 || px > x1 || py < y0 || py > y1) return false;
    const cx = Math.max(x0 + r, Math.min(px, x1 - r));
    const cy = Math.max(y0 + r, Math.min(py, y1 - r));
    return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
  };

  const N = 4;
  return (x, y) => {
    let cov = 0, ink = 0;
    for (let sy = 0; sy < N; sy++) {
      for (let sx = 0; sx < N; sx++) {
        const px = ((x + (sx + 0.5) / N) / size) * 64;
        const py = ((y + (sy + 0.5) / N) / size) * 64;
        if (!inTile(px, py)) continue;
        cov++;
        if (inInk(px, py)) ink++;
      }
    }
    if (cov === 0) return [0, 0, 0, 0];
    const m = ink / cov;
    return [
      Math.round(TILE[0] + (INK[0] - TILE[0]) * m),
      Math.round(TILE[1] + (INK[1] - TILE[1]) * m),
      Math.round(TILE[2] + (INK[2] - TILE[2]) * m),
      Math.round((255 * cov) / (N * N)),
    ];
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

async function buildFrontend() {
  // The pink design in frontend/. Static files are copied as-is; the two
  // scripts are bundled from src/ so the demo runs the real engine.
  await buildExt();

  const out = "frontend/dist";
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });

  const files = await collectFiles("extension/dist", "recreg-extension/");
  await writeFile(`${out}/recreg-extension.zip`, zipEntries(files));

  await build({
    entryPoints: { home: "src/site/home.ts", demo: "src/site/frontend-demo.ts" },
    bundle: true,
    format: "iife",
    outdir: out,
    target: ["es2020"],
    minify: true,
    logLevel: "info",
  });

  for (const f of ["index.html", "demo.html", "style.css", "favicon.svg"]) {
    await copyFile(`frontend/${f}`, `${out}/${f}`);
  }
  await cp("frontend/assets", `${out}/assets`, { recursive: true });
  console.log(`frontend → ${out}`);
}

async function buildSite(htmlDir = "site", outDir = "site/dist") {
  // The site ships a downloadable zip of the extension, so build that first.
  await buildExt();

  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const manifest = JSON.parse(await readFile("src/extension/manifest.json", "utf8"));
  const files = await collectFiles("extension/dist", "recreg-extension/");
  await writeFile(`${outDir}/recreg-extension.zip`, zipEntries(files));
  console.log(`${outDir}/recreg-extension.zip (v${manifest.version}, ${files.length} files)`);

  await build({
    entryPoints: { demo: "src/site/demo.ts" },
    bundle: true,
    format: "iife",
    outdir: outDir,
    target: ["es2020"],
    minify: true,
    logLevel: "info",
  });

  await copyFile(`${htmlDir}/index.html`, `${outDir}/index.html`);
  await copyFile("site/style.css", `${outDir}/style.css`);
  await writeFile(`${outDir}/favicon.png`, encodePng(32, iconPixel(32)));
  console.log(`${htmlDir} → ${outDir}`);
}

if (target === "ext") await buildExt();
if (target === "frontend") await buildFrontend();
if (target === "site" || target === "all") await buildSite(); // site build includes the extension
