import { describe, expect, it } from "vitest";
import { fitDistance, idleFar, idlePull } from "./fit";

describe("idle camera fit", () => {
  it("fits a circle exactly: its edge lands on the frame edge at margin 1", () => {
    const d = fitDistance(3, 35, 0.5, 1);
    expect(d * Math.tan((35 * Math.PI) / 360) * 0.5).toBeCloseTo(3, 9);
  });

  it("needs more distance as the frame narrows and as the circuit grows", () => {
    expect(fitDistance(3.5, 35, 0.46)).toBeGreaterThan(fitDistance(3.5, 35, 0.9));
    expect(fitDistance(4, 35, 0.5)).toBeGreaterThan(fitDistance(3, 35, 0.5));
  });

  it("pulls back on a portrait phone", () => {
    expect(idleFar(390 / 844, 3.52)).toBeGreaterThan(12.5);
  });

  it("keeps the designed framing on desktop and landscape", () => {
    expect(idleFar(1440 / 900, 3.52)).toBe(9.2);
    expect(idleFar(844 / 390, 4.12)).toBe(9.2);
  });

  it("moves the fog out by exactly the pull-back, and not at all where the framing is the designed one", () => {
    expect(idlePull(390 / 844, 3.52)).toBeCloseTo(idleFar(390 / 844, 3.52) - 12.5, 9);
    expect(idlePull(390 / 844, 3.52)).toBeGreaterThan(0);
    expect(idlePull(1440 / 900, 3.52)).toBe(0);
  });

  it("never jumps as a window is resized, apart from the designed step at a square frame", () => {
    for (const r of [2.23, 3.52, 4.12]) for (let a = 0.4; a < 2.4; a += 0.01) if (Math.abs(a + 0.005 - 1) > 0.01) expect(Math.abs(idleFar(a + 0.01, r) / idleFar(a, r) - 1), `${r} @ ${a.toFixed(2)}`).toBeLessThan(0.03);
  });
});
