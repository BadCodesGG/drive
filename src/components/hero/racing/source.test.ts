import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { bestKey } from "./engine/laps";
import { PREF_KEYS } from "./engine/prefs";

const ROOT = path.resolve(__dirname, "../../../..");
const HERO = path.join(ROOT, "src", "components", "hero", "racing");
const files = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const source = files(HERO).filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f));
const read = (f: string) => fs.readFileSync(f, "utf8");

describe("dependencies", () => {
  const pkg = JSON.parse(read(path.join(ROOT, "package.json")));
  const deps: Record<string, string> = { ...pkg.dependencies, ...pkg.devDependencies };

  it("pins three 0.186.x, @types/three 0.186.x and @react-three/fiber 9.8.x", () => {
    expect(deps.three).toMatch(/^[\^~]?0\.186\.\d+$/); // a caret on 0.x stays within 0.186
    expect(deps["@types/three"]).toMatch(/^[\^~]?0\.186\.\d+$/);
    expect(deps["@react-three/fiber"]).toMatch(/^~?9\.8\.\d+$/);
  });

  it("adds no other 3D dependency", () => {
    const threeish = Object.keys(deps).filter((d) => /three|drei|babylon|playcanvas|@react-three\//.test(d)).sort();
    expect(threeish).toEqual(["@react-three/fiber", "@types/three", "three"]);
  });

  it("never loads three from a CDN", () => {
    const hits = files(path.join(ROOT, "src")).filter((f) => /cdn\.jsdelivr|unpkg\.com|cdnjs|three@0\./.test(read(f)) && !f.endsWith("source.test.ts"));
    expect(hits).toEqual([]);
  });
});

describe("one render path", () => {
  const all = source.map(read).join("\n");

  it("has exactly one useFrame, at render priority 1, drawing engine.scene with engine.camera", () => {
    const frames = all.match(/useFrame\(/g) ?? [];
    expect(frames).toHaveLength(1);
    const bridge = read(path.join(HERO, "racing-hero.tsx"));
    expect(bridge).toMatch(/useFrame\(\(_, dt\) => \{[\s\S]*?gl\.render\(engine\.scene, engine\.camera\);[\s\S]*?\}, 1\);/);
  });

  it("uses <Canvas flat> and never <Canvas shadows>", () => {
    // Comments stripped, so the file's own "never <Canvas shadows>" note is not read as the prop.
    const hero = read(path.join(HERO, "racing-hero.tsx")).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    const canvas = hero.slice(hero.indexOf("<Canvas"), hero.indexOf(">", hero.indexOf("onCreated")));
    expect(canvas).toMatch(/^\s*flat\s*$/m);
    expect(canvas).not.toMatch(/\bshadows\b/);
    expect(all).not.toMatch(/useLegacyLights|toneMapping\s*=/);
  });
});

describe("saved settings", () => {
  it("keeps the hero-* localStorage keys, which visitors' saved settings and best laps depend on", () => {
    expect(PREF_KEYS).toEqual({ trackId: "hero-track", carId: "hero-car", look: "hero-look", view: "hero-camera", steer: "hero-steer" });
    expect(bestKey("spa", "gt3")).toBe("hero-best-lap-v3:spa:gt3");
    expect(bestKey("fuji", "f1")).toBe("hero-best-lap-v3:fuji:f1");
  });
});

describe("copy", () => {
  // No real manufacturer, team or sponsor name, and no third-party asset pack, in UI copy or models.
  const BRANDS = ["porsche", "ferrari", "mercedes", "red bull", "mclaren", "alpine", "williams", "aston martin", "alfa romeo", "haas", "bmw", "audi", "lamborghini", "nascar", "fia", "kenney", "tankco"];
  const banned = (text: string) => BRANDS.filter((b) => new RegExp(`\\b${b}\\b`, "i").test(text));

  it("has no banned brand name in the game's source", () => {
    const found = source.flatMap((f) => banned(read(f)).map((b) => `${path.basename(f)}: ${b}`));
    expect(found).toEqual([]);
  });

  it("has no banned brand name in any model's node names or metadata", () => {
    const dir = path.join(ROOT, "public", "hero", "models");
    const models = fs.readdirSync(dir).filter((f) => f.endsWith(".glb"));
    expect(models.length).toBeGreaterThan(0);
    const found = models.flatMap((m) => {
      // A .glb is a 12 byte header, then the JSON chunk (length, type, data): the names and asset block.
      const buf = fs.readFileSync(path.join(dir, m));
      const json = buf.subarray(20, 20 + buf.readUInt32LE(12)).toString("utf8");
      expect(() => JSON.parse(json), m).not.toThrow();
      return banned(json).map((b) => `${m}: ${b}`);
    });
    expect(found).toEqual([]);
  });

  it("has no em dash in the repo's own files", () => {
    // Every text file in the working tree: not build output, dependencies, binaries or env files.
    const skipDir = new Set(["node_modules", ".next", ".git", ".claude", ".vercel", "coverage"]);
    const walk = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        if (e.isDirectory()) return skipDir.has(e.name) ? [] : walk(path.join(dir, e.name));
        return e.name.startsWith(".env") || /\.(png|jpe?g|gif|webp|avif|ico|glb|woff2?|ttf|otf|mp4|webm|tsbuildinfo)$|^package-lock\.json$/i.test(e.name) ? [] : [path.join(dir, e.name)];
      });
    const touched = walk(ROOT);
    expect(touched.length).toBeGreaterThan(20);
    const dashed = touched.filter((f) => read(f).includes(String.fromCharCode(0x2014))).map((f) => path.relative(ROOT, f));
    expect(dashed).toEqual([]);
  });
});
