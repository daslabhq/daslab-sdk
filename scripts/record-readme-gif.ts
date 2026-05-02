/**
 * Record the scrubber as a GIF for the README.
 *
 *   bun scripts/record-readme-gif.ts
 *
 * Spins up a local server for viewer/, drives it with playwright, captures
 * a screenshot per scrub frame, then stitches into a GIF with ffmpeg.
 *
 * Output: docs/readme-demo.gif
 */

import { chromium } from "playwright";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const VIEWER_DIR = join(ROOT, "viewer");
const OUT_DIR = join(ROOT, "docs");
const OUT_GIF = join(OUT_DIR, "readme-demo.gif");
const PORT = 5751;
const BASE = `http://localhost:${PORT}`;
const FIXTURE = "example-traces/automationbench-jordan-lee-phone.jsonl";

mkdirSync(OUT_DIR, { recursive: true });

// 1. Boot a static server in the background.
console.log("→ booting static server …");
const server = spawn("python3", ["-m", "http.server", String(PORT)], {
  cwd:   VIEWER_DIR,
  stdio: ["ignore", "ignore", "ignore"],
});
await new Promise(r => setTimeout(r, 800));

// 2. Drive the scrubber with playwright; screenshot per frame.
const frameDir = mkdtempSync(join(tmpdir(), "scrubber-frames-"));
console.log(`→ frames → ${frameDir}`);

try {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 820 },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();

  await page.goto(BASE);
  await page.waitForSelector("#example-picker");

  // Pick the AutomationBench Jordan Lee fixture.
  await page.selectOption("#example-picker", FIXTURE);
  await page.waitForSelector("#viewer:not(.hidden)");
  await page.waitForTimeout(400);

  // Determine slider range, then walk it.
  const max = await page.$eval("#scrubber", (el: any) => parseInt(el.max, 10));
  console.log(`→ scrubbing 0 … ${max}`);

  // Start at step 0 to show the full timeline emerging.
  await page.$eval("#scrubber", (el: any) => { el.value = "0"; el.dispatchEvent(new Event("input", { bubbles: true })); });
  await page.waitForTimeout(500);

  // Hold each step for a beat (8fps base; 6 frames per step ≈ 750ms hold).
  let frame = 0;
  for (let i = 0; i <= max; i++) {
    await page.$eval("#scrubber", (el: any, v: number) => {
      el.value = String(v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }, i);
    await page.waitForTimeout(70);   // let the DOM settle
    for (let h = 0; h < 6; h++) {
      await page.screenshot({
        path: join(frameDir, `f-${String(frame).padStart(4, "0")}.png`),
        fullPage: false,
      });
      frame++;
      await page.waitForTimeout(120);
    }
  }
  // Hold final state a beat longer.
  for (let h = 0; h < 12; h++) {
    await page.screenshot({
      path: join(frameDir, `f-${String(frame).padStart(4, "0")}.png`),
    });
    frame++;
    await page.waitForTimeout(120);
  }

  console.log(`→ captured ${frame} frames`);
  await browser.close();

  // 3. Stitch with ffmpeg.
  console.log("→ ffmpeg …");
  if (existsSync(OUT_GIF)) rmSync(OUT_GIF);
  const ff = spawnSync("ffmpeg", [
    "-y",
    "-framerate", "12",
    "-i",         join(frameDir, "f-%04d.png"),
    "-vf",        "scale=900:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer:bayer_scale=5",
    "-loop",      "0",
    OUT_GIF,
  ], { stdio: "inherit" });
  if (ff.status !== 0) throw new Error("ffmpeg failed");

  const sizeKb = Math.round(Bun.file(OUT_GIF).size / 1024);
  console.log(`✓ ${OUT_GIF} (${sizeKb} KB)`);
} finally {
  server.kill();
  rmSync(frameDir, { recursive: true, force: true });
}
