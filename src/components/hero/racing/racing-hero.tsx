"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { PCFShadowMap } from "three";
import { useMediaQuery } from "@/hooks/use-media-query";
import { loadTrackData } from "./data";
import { createRacingEngine, type EngineState, type Phase, type RacingEngine } from "./engine/engine";
import { bindKeys } from "./engine/input";
import type { Pointer } from "./engine/mini";
import { Controls } from "./ui/controls";
import { Credit } from "./ui/credit";
import { Hud, Status, Veil } from "./ui/hud";
import { Loader } from "./ui/loader";
import { Pad } from "./ui/pad";

interface RacingHeroProps {
  /** Loop runs only while true (game on screen and tab visible). */
  active: boolean;
  /** The phone breakpoint, read once when the game mounts (later changes are ignored, see below). */
  mobile: boolean;
  /** prefers-reduced-motion: the idle miniature stays a still frame, and only a drive runs the loop. */
  reduced: boolean;
  /** The sibling [data-hero-ui] layer the controls portal into. */
  uiRoot: HTMLElement;
  /** A frame of the miniature has been drawn. */
  onReady: () => void;
  /** No usable GL context, or the circuit's data would not load: fall back to the still gradient. */
  onUnavailable: () => void;
}

const noop = () => () => {};
/** A drive is under way (from Drive until Esc or Exit): the section is the drive's stage. */
const DRIVING: readonly Phase[] = ["loading", "in", "drive"];

/** The engine's low-frequency state for React; per-frame numbers never pass through here. */
function useEngineState(engine: RacingEngine | null): EngineState | null {
  return useSyncExternalStore(engine ? engine.subscribe : noop, () => (engine ? engine.getState() : null), () => null);
}

/**
 * The only place React meets the renderer: hands R3F's renderer and size to the engine, and one
 * priority-1 useFrame (which switches off R3F's own render) steps the engine and draws its scene.
 */
function EngineBridge({ engine, pointer }: { engine: RacingEngine; pointer: RefObject<Pointer> }) {
  const gl = useThree((s) => s.gl);
  const width = useThree((s) => s.size.width);
  const height = useThree((s) => s.size.height);
  const dpr = useThree((s) => s.viewport.dpr);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => engine.attach(gl), [engine, gl]);
  useEffect(() => {
    engine.resize(width, height, dpr);
    invalidate();
  }, [engine, width, height, dpr, invalidate]);
  // A rebuilt miniature (a new circuit or car) draws even while the loop is paused.
  useEffect(() => engine.subscribe(invalidate), [engine, invalidate]);
  useFrame((_, dt) => {
    engine.frame(dt, pointer.current);
    gl.render(engine.scene, engine.camera);
    engine.afterRender();
  }, 1);
  return null;
}

/** Wires the canvas's context-loss events; it unmounts together with the canvas it listens to. */
function ContextGuard({ onLost, onRestored }: { onLost: () => void; onRestored: () => void }) {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    const el = gl.domElement;
    const lost = (e: Event) => {
      // preventDefault asks the browser to restore the context later.
      e.preventDefault();
      onLost();
    };
    el.addEventListener("webglcontextlost", lost);
    el.addEventListener("webglcontextrestored", onRestored);
    return () => {
      el.removeEventListener("webglcontextlost", lost);
      el.removeEventListener("webglcontextrestored", onRestored);
    };
  }, [gl, onLost, onRestored]);
  return null;
}

/**
 * The racing game's lazy root: the engine's lifetime (one per mount), the canvas, the pointer
 * parallax on the stage section, and the controls portalled into the UI layer.
 */
export default function RacingHero({ active, mobile: mobileAtMount, reduced, uiRoot, onReady, onUnavailable }: RacingHeroProps) {
  // Phone or desktop is decided once per mount: rotating a phone to landscape or resizing across the
  // breakpoint must not throw away the engine and the canvas mid-drive, nor give a landscape phone
  // desktop settings.
  const [mobile] = useState(mobileAtMount);
  const [engine, setEngine] = useState<RacingEngine | null>(null);
  const state = useEngineState(engine);
  const pointer = useRef<Pointer>({ x: 0, y: 0, inside: false });
  const [lost, setLost] = useState(false);
  const onLost = useCallback(() => setLost(true), []);
  const onRestored = useCallback(() => setLost(false), []);
  // A keyboard and a fine, hovering pointer drive with keys; anything else gets the phone pad.
  const canHover = useMediaQuery("(hover: hover) and (pointer: fine)");
  const drive = useRef<HTMLButtonElement>(null);

  // One engine per mount and motion preference (its miniature's mesh density follows the mount's
  // breakpoint, its dive the preference); freed on unmount.
  useEffect(() => {
    const e = createRacingEngine({ mobile, reduced, loadTrack: loadTrackData });
    // Not derivable in render: the engine is an external resource whose create/dispose pair must
    // follow the effect (StrictMode remounts it), and it must not exist during render or on the server.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEngine(e);
    return () => e.dispose();
  }, [mobile, reduced]);

  // Off screen or in a hidden tab the car stands still.
  useEffect(() => engine?.setActive(active), [engine, active]);

  // The keyboard: a letter starts a drive only from the racing controls; once driving, the
  // driving keys work page-wide until Esc or Exit.
  useEffect(() => {
    if (!engine) return;
    return bindKeys(window, { key: engine.key, clearKeys: engine.clearKeys, driving: () => DRIVING.includes(engine.getState().phase) });
  }, [engine]);

  // Debug hooks are opt-in: the chunk is requested only when the flag is set.
  useEffect(() => {
    if (!engine) return;
    let flag = false;
    try {
      flag = localStorage.getItem("hero-debug") === "1";
    } catch {}
    if (!flag) return;
    let off: (() => void) | null = null, gone = false;
    import("./engine/debug").then((m) => {
      if (!gone) off = m.installHeroDebug(engine);
    });
    return () => {
      gone = true;
      off?.();
    };
  }, [engine]);

  // The pointer tilts the miniature, measured over the whole stage section.
  useEffect(() => {
    const section = uiRoot.parentElement;
    if (!section) return;
    const p = pointer.current;
    const move = (e: PointerEvent) => {
      const r = section.getBoundingClientRect();
      p.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      p.y = ((e.clientY - r.top) / r.height) * 2 - 1;
      p.inside = true;
    };
    const leave = () => {
      p.inside = false;
      p.x *= 0.5;
      p.y *= 0.5;
    };
    section.addEventListener("pointermove", move, { passive: true });
    section.addEventListener("pointerleave", leave);
    return () => {
      section.removeEventListener("pointermove", move);
      section.removeEventListener("pointerleave", leave);
    };
  }, [uiRoot]);

  const ready = !!state?.ready, failed = !!state?.failed, phase = state?.phase ?? "idle", world = state?.world ?? "mini";
  const driving = DRIVING.includes(phase);
  useEffect(() => {
    if (ready) onReady();
  }, [ready, onReady]);

  // While driving, the stage section is the drive's stage: it fills the window and is scrolled
  // into it, its copy fades and leaves the tab order (and the drive world entirely), and the scene
  // layer is unmasked (globals.css reads the attributes). Laid out before paint, so no frame shows
  // the copy still live.
  useLayoutEffect(() => {
    const section = uiRoot.parentElement;
    if (!section || !driving) return;
    const copy = [...section.children].filter((el): el is HTMLElement => el instanceof HTMLElement && !el.matches("[data-hero-scene], [data-hero-ui]"));
    section.setAttribute("data-hero-driving", "true");
    copy.forEach((el) => {
      el.inert = true;
    });
    // The HUD sits on the section's top edge and the speedometer on its bottom, so the whole of it
    // comes into the window: read after the attribute above, the section is the window's height
    // (globals.css), so bringing its top to the window's top lands it flush.
    const dy = section.getBoundingClientRect().top;
    if (Math.abs(dy) > 1) scrollBy({ top: dy, behavior: reduced ? "auto" : "smooth" });
    return () => {
      section.removeAttribute("data-hero-driving");
      copy.forEach((el) => {
        el.inert = false;
      });
    };
  }, [driving, uiRoot, reduced]);
  useLayoutEffect(() => {
    const section = uiRoot.parentElement;
    if (!section || world !== "drive") return;
    section.setAttribute("data-hero-world", "drive");
    return () => {
      section.removeAttribute("data-hero-world");
    };
  }, [world, uiRoot]);

  // Back at rest after Cancel, Esc or Exit, focus returns to Drive unless the visitor has
  // already moved it somewhere else on the page.
  const prevPhase = useRef<Phase>(phase);
  useEffect(() => {
    const was = prevPhase.current;
    prevPhase.current = phase;
    if (phase !== "idle" || was === "idle") return;
    const a = document.activeElement;
    if (was === "loading" || !a || a === document.body || uiRoot.contains(a)) drive.current?.focus({ preventScroll: true });
  }, [phase, uiRoot]);
  useEffect(() => {
    if (failed) onUnavailable();
  }, [failed, onUnavailable]);

  if (!engine || !state) return null;
  return (
    <>
      <Canvas
        flat // NoToneMapping, so each circuit's mood keeps its colours; never <Canvas shadows>
        // "demand" rather than "never" while paused: the canvas still draws a requested frame, so one
        // mounted off-screen or in a hidden tab is not blank when it appears. Under reduced motion the
        // idle miniature is a still frame; only a drive runs the loop.
        frameloop={active && !lost && !(reduced && phase === "idle") ? "always" : "demand"}
        // antialias and dpr are read only at creation; mobile never changes within a mount.
        dpr={mobile ? [1, 1.5] : [1, 2]}
        gl={{ antialias: !mobile, alpha: true, powerPreference: "low-power" }}
        onCreated={({ gl }) => {
          gl.shadowMap.enabled = true;
          gl.shadowMap.type = PCFShadowMap;
          if (gl.getContext().isContextLost()) onUnavailable();
        }}
      >
        <ContextGuard onLost={onLost} onRestored={onRestored} />
        <EngineBridge engine={engine} pointer={pointer} />
      </Canvas>
      {createPortal(
        <>
          <Veil engine={engine} color={state.fog} />
          <Controls trackId={state.trackId} carId={state.carId} look={state.lookFailed ? "lowpoly" : state.look} onTrack={engine.setTrack} onCar={engine.setCar} onLook={engine.setLook} onDrive={engine.enter} driveRef={drive} hidden={driving} />
          {phase === "loading" && state.progress && <Loader label={state.progress.label} value={state.progress.value} focusCancel={canHover} onCancel={engine.exit} />}
          {/* The pad shows from Drive on, loading included, under the loader and the HUD. */}
          {driving && !canHover && <Pad engine={engine} steer={state.steer} view={state.view} />}
          {(phase === "in" || phase === "drive") && <Hud engine={engine} keyHint={canHover} touch={!canHover} />}
          <Credit />
          <Status text={state.status.text} n={state.status.n} />
        </>,
        uiRoot,
      )}
    </>
  );
}
