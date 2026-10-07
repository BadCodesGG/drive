"use client";

import { Component, type ReactNode } from "react";

/**
 * The two guards every stage that mounts the racing game needs (src/app/drive-stage.tsx uses them).
 * Kept in this small module, apart from the game, so a page can probe for WebGL 2 without pulling
 * in three and r3f.
 */

// three dropped WebGL 1 in r163, so only a WebGL 2 context counts: a WebGL-1-only browser must
// keep the still gradient rather than download three and fail.
export function hasWebGL2(): boolean {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2");
    // Release the probe's context now rather than waiting on GC; browsers cap live contexts.
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
    return !!gl;
  } catch {
    return false;
  }
}

/** Renders nothing once the game throws while rendering, and reports it so the stage can fall back. */
export class SceneBoundary extends Component<
  { onFail: () => void; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onFail();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}
