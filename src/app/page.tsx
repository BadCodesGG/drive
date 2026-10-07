import { SHADOW } from "@/components/hero/racing/ui/legible";
import { DriveStage } from "./drive-stage";

export default function Home() {
  return (
    <main>
      <DriveStage>
        {/* A sibling of the scene and controls layers, so the game fades it while driving and drops
            it from the tab order. The game's own text shadow keeps it legible over the brightest
            terrain; the tagline and link are full ink, not secondary, because secondary ink fell
            under 4.5:1 over Fuji's sky. The tagline is sized to be the page's largest paint with a
            20% margin over the game's credit line, which draws only once the scene has loaded. */}
        <header className={`pointer-events-none absolute left-6 top-5 md:left-16 md:top-8 ${SHADOW}`}>
          <h1 className="w-fit font-display text-3xl font-black tracking-tight md:text-5xl">Drive</h1>
          {/* Capped from md to xl, where the game's pickers share the top row with it. */}
          <p className="mt-1 pr-6 text-xl leading-8 text-ink md:max-w-[22rem] md:pr-0 xl:max-w-none">
            Spa, Sebring and Fuji at true scale, in a GT3 or an F1 car.
          </p>
          <a
            href="https://badcodes.dev"
            className="pointer-events-auto mt-0.5 inline-block py-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-ink underline decoration-dotted underline-offset-2 hover:decoration-solid focus-visible:outline-2 focus-visible:outline-accent"
          >
            badcodes.dev
          </a>
        </header>
      </DriveStage>
    </main>
  );
}
