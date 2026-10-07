/** Camera distance at which a circle of the given radius, centred on the view axis, spans the frame's width with some margin. */
export function fitDistance(radius: number, vfovDeg: number, aspect: number, margin = 1.08): number {
  const halfH = Math.tan((vfovDeg * Math.PI) / 360);
  return (radius * margin) / (halfH * aspect);
}

/**
 * How far back the idle camera sits: the designed distance (12.5 portrait, 9.2 otherwise), pulled back
 * only where the circuit would run off the sides. The fit shrinks as the frame widens, so a wide frame
 * keeps the designed framing, and the distance never jumps as a window is resized.
 */
export function idleFar(aspect: number, radius: number, vfovDeg = 35): number {
  return Math.max(idleBase(aspect), fitDistance(radius, vfovDeg, aspect));
}

/** The designed idle distance for an aspect, before any pull-back. */
export const idleBase = (aspect: number) => (aspect < 1 ? 12.5 : 9.2);

/**
 * How much further than designed the idle camera sits. The miniature's fog is pushed out by the same
 * amount, so a pulled-back circuit keeps the haze it was designed with instead of fading into it.
 */
export const idlePull = (aspect: number, radius: number, vfovDeg = 35) => idleFar(aspect, radius, vfovDeg) - idleBase(aspect);
