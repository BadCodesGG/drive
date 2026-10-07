"use client";

import { memo, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import type { RacingEngine } from "../engine/engine";
import { SHADOW } from "./legible";

/**
 * The driving HUD, the arc speedometer and Exit. React renders them once; the
 * engine writes every per-frame number straight into their elements (bindHud), so this component
 * does not re-render while driving (the debug hooks count its renders). On touch (the phone pad
 * showing), Exit lives in the pad's top bar, and the HUD and speedometer sit under it, the
 * speedometer on the right, clear of the pad's Brake pedal and hints.
 */
export const Hud = memo(function Hud({ engine, keyHint, touch }: { engine: RacingEngine; keyHint: boolean; touch: boolean }) {
  const msg = useRef<HTMLSpanElement>(null), spd = useRef<HTMLElement>(null), lap = useRef<HTMLElement>(null), last = useRef<HTMLElement>(null);
  const bestLabel = useRef<HTMLSpanElement>(null), best = useRef<HTMLElement>(null), delta = useRef<HTMLElement>(null);
  const speedo = useRef<HTMLDivElement>(null), speedoFill = useRef<SVGPathElement>(null), speedoNum = useRef<HTMLElement>(null);
  useEffect(
    () => engine.bindHud({ msg: msg.current, spd: spd.current, lap: lap.current, last: last.current, bestLabel: bestLabel.current, best: best.current, delta: delta.current, speedo: speedo.current, speedoFill: speedoFill.current, speedoNum: speedoNum.current }),
    [engine],
  );
  // No dependency list: this runs after every commit, which is what the debug hooks count.
  useEffect(() => engine.hudCommitted());
  const b = "font-medium tabular-nums text-ink-secondary";
  return (
    <>
      <div data-hero-hud className={`pointer-events-none absolute ${touch ? "left-3 right-[136px] top-16 md:left-16 md:right-[184px]" : "left-6 right-24 top-3 md:left-16 md:right-40"} flex flex-wrap items-baseline gap-x-3.5 gap-y-1 font-mono text-[11px] tracking-[0.04em] text-ink-secondary ${SHADOW}`}>
        <span className="flex flex-wrap gap-x-3.5 gap-y-1 bg-bg/60 px-2 py-1">
          <span ref={msg} data-tone="" className="font-bold text-accent empty:hidden data-[tone=bad]:text-caution data-[tone=good]:text-positive" />
          <span>SPD <b ref={spd} className={b}>0 km/h</b></span>
          <span>LAP <b ref={lap} className={b}>out lap</b></span>
          <span>LAST <b ref={last} className={b}>-:--.---</b></span>
          <span><span ref={bestLabel}>REF</span> <b ref={best} className={b}>-:--.---</b></span>
          <span>Δ <b ref={delta} className={b}>--</b></span>
          {keyHint && <span>R resets · Esc exits</span>}
        </span>
      </div>
      {!touch && <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={engine.exit}
        className="pointer-events-auto absolute right-6 top-2 h-auto min-h-6 rounded-none border-border bg-bg/70 px-3 py-1 font-mono text-[11px] font-normal uppercase tracking-[0.08em] text-ink backdrop-blur-md hover:border-ink-tertiary hover:bg-bg/70 focus-visible:ring-2 focus-visible:ring-accent md:right-16"
      >
        Exit
      </Button>}
      {/* Filled by speed as a share of this car's top speed. The SPD readout already says the same
          thing to assistive tech, so this stays hidden from it. */}
      <div ref={speedo} data-hero-speedo data-speed="0" aria-hidden="true" className={`pointer-events-none absolute ${touch ? "right-3 top-16" : "bottom-14 right-6 md:bottom-[68px]"} h-[72px] w-28 text-center font-mono text-ink md:right-16 ${SHADOW}`}>
        <svg viewBox="0 0 100 58" className="absolute inset-0 h-full w-full overflow-visible">
          <path d="M10 52 A40 40 0 0 1 90 52" pathLength={1} fill="none" strokeWidth={7} strokeLinecap="round" className="stroke-[color-mix(in_srgb,var(--ink)_16%,transparent)]" />
          <path ref={speedoFill} d="M10 52 A40 40 0 0 1 90 52" pathLength={1} strokeDasharray="0 1" fill="none" strokeWidth={7} strokeLinecap="round" className="stroke-accent" />
        </svg>
        <b ref={speedoNum} className="absolute inset-x-0 bottom-4 text-xl font-bold tabular-nums">0</b>
        <span className="absolute inset-x-0 bottom-1 text-[9px] uppercase tracking-[0.1em] text-ink-secondary">km/h</span>
      </div>
    </>
  );
});

/** The fog-coloured veil the dive crosses; the engine sets its opacity per frame. */
export function Veil({ engine, color }: { engine: RacingEngine; color: string | null }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => engine.bindHud({ veil: ref.current }), [engine]);
  return <div ref={ref} data-hero-veil aria-hidden="true" className="pointer-events-none absolute inset-0" style={{ background: color ?? "transparent", opacity: 0 }} />;
}

/**
 * The polite live region every message the engine says reaches; never a per-frame
 * number. Keyed by the message's count, so the same words said twice are announced twice.
 */
export function Status({ text, n }: { text: string; n: number }) {
  return (
    <div data-hero-status role="status" aria-live="polite" className="sr-only">
      <span key={n}>{text}</span>
    </div>
  );
}
