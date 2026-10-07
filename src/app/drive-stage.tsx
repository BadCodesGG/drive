"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { hasWebGL2, SceneBoundary } from "@/components/hero/scene-guard";
import { useIsMobile, useMediaQuery } from "@/hooks/use-media-query";

// three and r3f arrive only in this chunk, and only once WebGL 2 is known to be present.
const RacingHero = dynamic(() => import("@/components/hero/racing/racing-hero"), { ssr: false });

/**
 * The game's two layers (scene and controls) over a section that is the whole window. The game
 * treats the section as its stage: it tilts the miniature with the pointer over it, and while
 * driving it fades every other child (the title here) and makes it inert. There is no wait for
 * idle and no reduced-motion opt-in, because the game is what this page is for; under reduced
 * motion the game itself keeps the idle miniature still and runs only a drive.
 */
export function DriveStage({ children }: { children: ReactNode }) {
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  const mobile = useIsMobile();
  const [uiRoot, setUiRoot] = useState<HTMLDivElement | null>(null);
  // null until probed after mount: the server cannot know.
  const [webgl, setWebgl] = useState<boolean | null>(null);
  const [failed, setFailed] = useState(false);
  const [drawn, setDrawn] = useState(false);
  const [tabVisible, setTabVisible] = useState(true);
  const onReady = useCallback(() => setDrawn(true), []);
  const onFail = useCallback(() => setFailed(true), []);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setWebgl(hasWebGL2()));
    const onVis = () => setTabVisible(!document.hidden);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  const showScene = webgl === true && !failed && !!uiRoot;
  const unavailable = webgl === false || failed;

  return (
    <section className="relative isolate h-dvh overflow-hidden">
      {/* First in the DOM, so the title reads and tabs before the game's controls. */}
      {children}
      <div
        aria-hidden="true"
        data-hero-scene={showScene ? "live" : "static"}
        data-hero-ready={showScene && drawn ? "true" : "false"}
        // Whether the loop is running, for tests and scripts that read it.
        data-hero-active={showScene && tabVisible ? "true" : "false"}
        className="pointer-events-none absolute inset-0 -z-10 overflow-hidden bg-[radial-gradient(circle_at_60%_45%,color-mix(in_srgb,var(--accent)_22%,transparent),transparent_60%)]"
      >
        {showScene && (
          <SceneBoundary onFail={onFail}>
            <RacingHero active={tabVisible} mobile={mobile} reduced={reduced} uiRoot={uiRoot} onReady={onReady} onUnavailable={onFail} />
          </SceneBoundary>
        )}
      </div>
      <div ref={setUiRoot} data-hero-ui className="pointer-events-none absolute inset-0 z-10">
        {unavailable && (
          <p role="status" data-hero-note className="absolute inset-x-6 bottom-14 text-right font-mono text-balance text-[11px] uppercase tracking-[0.06em] text-ink-secondary md:inset-x-auto md:bottom-auto md:right-16 md:top-8">
            {failed ? "The circuit could not load. Try reloading the page." : "Drive needs WebGL 2. Try a current Chrome, Edge, Firefox or Safari, with hardware acceleration on."}
          </p>
        )}
      </div>
    </section>
  );
}
