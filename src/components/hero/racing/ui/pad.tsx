"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { RacingEngine } from "../engine/engine";
import { createPad, type PadController, type PadEnv } from "../engine/pad";
import type { Steer, View } from "../engine/prefs";
import { CHIP, SHADOW } from "./legible";

// Pad labels hold 4.5:1 over bright scenery: the HUD's shadow plus a translucent chip.
const LABEL = `${CHIP} font-mono text-[11px] uppercase tracking-[0.08em] text-ink-secondary`;
// Exit, View and the steering mode: 36 px, 44 px on a coarse pointer.
const TOP = "h-9 rounded-none font-mono text-[11px] font-normal uppercase tracking-[0.08em] shadow-none pointer-coarse:h-11 focus-visible:ring-2 focus-visible:ring-accent";

/** iOS's DeviceOrientationEvent.requestPermission, absent everywhere else. */
type OrientationCtor = { requestPermission?: () => Promise<string> };

function browserEnv(): PadEnv {
  const ctor = typeof DeviceOrientationEvent === "undefined" ? null : (DeviceOrientationEvent as unknown as OrientationCtor);
  return {
    hasTilt: ctor !== null,
    onTilt(fn) {
      const on = (e: DeviceOrientationEvent) => fn(e);
      window.addEventListener("deviceorientation", on);
      return () => window.removeEventListener("deviceorientation", on);
    },
    angle: () => screen.orientation?.angle ?? 0,
    now: () => performance.now(),
    later(fn, ms) {
      const id = window.setTimeout(fn, ms);
      return () => window.clearTimeout(id);
    },
    requestPermission: typeof ctor?.requestPermission === "function" ? () => (ctor.requestPermission as () => Promise<string>).call(DeviceOrientationEvent) : undefined,
  };
}

/**
 * The phone pad while driving on a device without a fine hovering pointer: hold the left or right half to steer, a visible Brake pedal (or both halves) to
 * slow, or Tilt to steer by tilting the phone; View cycles chase and cockpit, Exit leaves. The whole
 * section is its touch surface; engine/pad.ts turns the fingers into keys.
 */
export function Pad({ engine, steer, view }: { engine: RacingEngine; steer: Steer; view: View }) {
  const root = useRef<HTMLDivElement>(null);
  const ctl = useRef<PadController | null>(null);
  const [braking, setBraking] = useState(false);
  const [hasTilt] = useState(() => typeof DeviceOrientationEvent !== "undefined");
  const mode: Steer = hasTilt ? steer : "touch";

  useEffect(() => {
    const c = createPad(engine.getState().steer, { keys: (k) => { engine.pad(k); setBraking(k.s); }, say: engine.say, mode: engine.setSteer }, browserEnv());
    ctl.current = c;
    c.start();
    return () => {
      c.stop();
      ctl.current = null;
    };
  }, [engine]);

  const sideOf = (x: number) => {
    const r = (root.current as HTMLDivElement).getBoundingClientRect();
    return x < r.left + r.width / 2 ? "l" : "r";
  };
  const down = (e: PointerEvent<HTMLDivElement>) => {
    const t = e.target as Element;
    if (t.closest("button")) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    ctl.current?.down(e.pointerId, t.closest("[data-hero-brake]") ? "b" : sideOf(e.clientX));
  };
  const up = (e: PointerEvent<HTMLDivElement>) => ctl.current?.up(e.pointerId);

  return (
    <div
      ref={root}
      data-hero-pad
      data-mode={mode}
      onPointerDown={down}
      onPointerMove={(e) => ctl.current?.move(e.pointerId, sideOf(e.clientX))}
      onPointerUp={up}
      onPointerCancel={up}
      className="pointer-events-auto absolute inset-0 touch-none select-none"
    >
      <div className="absolute inset-x-3 top-2 flex items-start justify-between gap-2 md:inset-x-16">
        <div role="group" aria-label="Steering" data-hero-pad-mode className="flex gap-0.5 border border-border bg-bg/70 p-px">
          {(hasTilt ? (["touch", "tilt"] as const) : (["touch"] as const)).map((m) => (
            <Button
              key={m}
              type="button"
              variant="ghost"
              aria-pressed={m === mode}
              onClick={() => void ctl.current?.setMode(m)}
              className={cn(TOP, "px-2.5 text-ink-secondary aria-pressed:bg-accent aria-pressed:text-ink-inverted", m !== mode && SHADOW)}
            >
              {m === "touch" ? "Touch" : "Tilt"}
            </Button>
          ))}
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" data-hero-view onClick={engine.toggleView} className={cn(TOP, "border-border bg-bg/70 px-3 text-ink hover:bg-bg/70", SHADOW)}>
            View: {view === "cockpit" ? "Cockpit" : "Chase"}
          </Button>
          <Button type="button" variant="outline" data-hero-exit onClick={engine.exit} className={cn(TOP, "border-border bg-bg/70 px-3 text-ink hover:bg-bg/70", SHADOW)}>
            Exit
          </Button>
        </div>
      </div>
      {mode === "touch" && (
        <>
          <span data-hero-pad-l className={cn(LABEL, "pointer-events-none absolute left-3 top-1/2 md:left-16")}>‹ Steer</span>
          <span data-hero-pad-r className={cn(LABEL, "pointer-events-none absolute right-3 top-1/2 md:right-16")}>Steer ›</span>
        </>
      )}
      <div
        role="button"
        aria-label="Brake (hold)"
        data-hero-brake
        data-on={braking}
        className={cn(
          // Portrait: centred above the hint. A short (landscape) screen has the chase car in the middle, so there Brake moves to the right corner, above the credit.
          "absolute bottom-28 left-1/2 grid h-14 w-28 -translate-x-1/2 place-items-center rounded-[10px] [@media(max-height:500px)]:bottom-[72px] [@media(max-height:500px)]:left-auto [@media(max-height:500px)]:right-3 [@media(max-height:500px)]:translate-x-0 md:[@media(max-height:500px)]:right-16 border border-border bg-bg/70 font-mono text-[13px] font-bold uppercase tracking-[0.1em] text-ink [-webkit-touch-callout:none]",
          braking ? "bg-accent text-ink-inverted" : SHADOW,
        )}
      >
        Brake
      </div>
      <span data-hero-pad-hint className={cn(LABEL, "pointer-events-none absolute inset-x-0 bottom-[72px] mx-auto w-fit max-w-[calc(100%-1.5rem)] text-center")}>
        {mode === "tilt" ? "Tilt to steer · hold Brake to slow" : "Hold Brake or both sides to slow"}
      </span>
    </div>
  );
}
