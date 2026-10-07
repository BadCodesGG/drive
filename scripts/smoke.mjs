// Serves the production build (run `npm run build` first) on a spare port, or uses DRIVE_URL if set.
// Checks that every Detailed model is served from /hero/models/, then in headless Chromium, on a
// desktop and a phone viewport: the miniature draws, Drive enters the drive world and hides the
// title, the car moves (held throttle on the keyboard, the pad's automatic throttle on the phone), and Esc returns to
// the miniature, with no page error or console warning except R3F's one THREE.Clock deprecation
// (R3F 9.8 constructs a THREE.Clock, which three 0.186 deprecates). Drives in Low poly: rendering
// Detailed under SwiftShader on a hosted runner costs minutes. Screenshots go to OUT_DIR.
import { spawn } from "node:child_process";
import { mkdirSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { chromium } from "playwright";

const app = path.join(import.meta.dirname, "..");
let server = null;
let url = process.env.DRIVE_URL;
if (!url) {
  const port = 3131;
  url = `http://localhost:${port}`;
  const next = createRequire(path.join(app, "package.json")).resolve("next/dist/bin/next");
  server = spawn(process.execPath, [next, "start", "--port", String(port)], { cwd: app, stdio: "ignore" });
  // Killed by pid on any exit, a failed check or a throw included, so no server is left holding the port.
  // The child keeps the event loop alive, so the script always ends with an explicit process.exit.
  process.on("exit", () => server.kill());
  const until = Date.now() + 60_000;
  for (;;) {
    try {
      if ((await fetch(url)).ok) break;
    } catch {}
    if (Date.now() > until) throw new Error(`drive app did not answer on ${url} within 60 s`);
    await new Promise((r) => setTimeout(r, 500));
  }
}
const out = process.env.OUT_DIR ?? path.join(app, ".smoke");
mkdirSync(out, { recursive: true });

const failures = [];
const check = (what, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${what}${detail ? `: ${detail}` : ""}`);
  if (!ok) failures.push(what);
};
// Generous ceilings: a hosted runner draws about a frame a second under SwiftShader.
const waitFor = (p, fn, timeout) => p.waitForFunction(fn, null, { timeout }).then(() => true, () => false);

const models = readdirSync(path.join(app, "public/hero/models"));
const served = await Promise.all(models.map(async (m) => `${(await fetch(`${url}/hero/models/${m}`)).status} ${m}`));
check("every Detailed model is served from /hero/models/", models.length > 0 && served.every((m) => m.startsWith("200")), served.join(", "));

const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
for (const [name, viewport, isMobile] of [["desktop", { width: 1280, height: 720 }, false], ["phone", { width: 390, height: 844 }, true]]) {
  const ctx = await browser.newContext({ viewport, isMobile, hasTouch: isMobile });
  await ctx.addInitScript(() => {
    localStorage.setItem("hero-debug", "1");
    localStorage.setItem("hero-look", "lowpoly");
  });
  const p = await ctx.newPage();
  const problems = [];
  p.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  p.on("console", (m) => {
    if (!["error", "warning"].includes(m.type())) return;
    if (m.text().startsWith("THREE.Clock: This module has been deprecated")) return;
    problems.push(`${m.type()}: ${m.text()}`);
  });

  await p.goto(url);
  const drawn = await waitFor(p, () => document.querySelector('[data-hero-scene][data-hero-ready="true"]') && window.__heroDebug?.renderer?.info.render.frame > 0, 180_000);
  await p.screenshot({ path: path.join(out, `${name}-idle.png`) });
  check(`${name}: the miniature draws`, drawn, await p.title());
  if (!drawn) {
    await ctx.close();
    continue;
  }

  await p.click("[data-hero-drive]");
  const entered = await waitFor(p, () => window.__heroDebug.phase === "drive", 300_000);
  const state = await p.evaluate(() => ({ world: window.__heroDebug.world, driving: document.querySelector("section").dataset.heroDriving ?? null, title: getComputedStyle(document.querySelector("header")).visibility }));
  check(`${name}: Drive enters the drive world`, entered && state.world === "drive" && state.driving === "true", JSON.stringify(state));
  check(`${name}: the title leaves while driving`, state.title === "hidden", state.title);

  if (entered) {
    // The phone pad's throttle is automatic; on the keyboard it is held until the car moves.
    if (!isMobile) await p.keyboard.down("ArrowUp");
    const moved = await waitFor(p, () => Math.abs(window.__heroDebug.G.v) > 5, 120_000);
    if (!isMobile) await p.keyboard.up("ArrowUp");
    await p.screenshot({ path: path.join(out, `${name}-drive.png`) });
    check(`${name}: the car moves`, moved, `speed ${(await p.evaluate(() => Math.abs(window.__heroDebug.G.v))).toFixed(1)} m/s`);
    await p.keyboard.press("Escape");
    check(`${name}: Esc returns to the miniature`, await waitFor(p, () => window.__heroDebug.phase === "idle" && window.__heroDebug.world === "mini", 120_000), await p.evaluate(() => `${window.__heroDebug.phase}/${window.__heroDebug.world}`));
  }
  check(`${name}: no page errors or console warnings`, problems.length === 0, problems.join(" | "));
  await ctx.close();
}

await browser.close();
console.log(failures.length ? `${failures.length} failed` : "all passed");
process.exit(failures.length ? 1 : 0);
