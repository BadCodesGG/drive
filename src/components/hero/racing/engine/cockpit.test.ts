import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { CARS } from "./cars";
import { cockpitFov, cockpitPose } from "./cockpit";

// Expected values come from drive5.mjs's own independent eye formula (heading rotation of the car's
// eye offset, local +x forward and +z the driver's right) and from plain trigonometry, never from the
// function under test.
const flat = { roll: 0, pitch: 0 }, noFloor = () => -Infinity;
const cam = () => ({ position: new THREE.Vector3(), quaternion: new THREE.Quaternion() });
const G = (h: number) => ({ pos: new THREE.Vector3(12, 0, -40), h, y: 3.2 });

describe("the cockpit camera", () => {
  it.each(Object.keys(CARS) as (keyof typeof CARS)[])("%s: sits on the car's eye point on a flat road", (id) => {
    const car = CARS[id], g = G(0.7), c = cam(), e = { x: car.eyeX, y: car.eyeY, z: car.eyeZ };
    cockpitPose(c, g, flat, flat, e, 1, 0, noFloor);
    const want = [g.pos.x + Math.cos(g.h) * e.x - Math.sin(g.h) * e.z, g.y + e.y, g.pos.z + Math.sin(g.h) * e.x + Math.cos(g.h) * e.z];
    expect(Math.hypot(c.position.x - want[0], c.position.y - want[1], c.position.z - want[2])).toBeLessThan(1e-9);
    // It looks along the car's heading: forward (the camera's -z) is (cos h, 0, sin h).
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(c.quaternion);
    expect(fwd.x).toBeCloseTo(Math.cos(g.h), 9); expect(fwd.y).toBeCloseTo(0, 9); expect(fwd.z).toBeCloseTo(Math.sin(g.h), 9);
  });

  it("rolls with the body: the camera's own tilt is the body's roll, damped to a third under reduced motion", () => {
    const e = { x: 0, y: 1.1, z: 0 }, tilt = (damp: number) => {
      const c = cam(); cockpitPose(c, G(0), flat, { roll: 0.09, pitch: 0 }, e, damp, 0, noFloor);
      // Heading 0: the car's right is +z; the up vector leans toward it by the roll angle.
      return new THREE.Vector3(0, 1, 0).applyQuaternion(c.quaternion).z;
    };
    expect(tilt(1)).toBeCloseTo(Math.sin(0.09), 9);
    expect(tilt(1 / 3)).toBeCloseTo(Math.sin(0.03), 9);
  });

  it("never goes below the surface: the eye stays 0.2 m over whatever lies under it", () => {
    const c = cam(); cockpitPose(c, G(0), flat, flat, { x: 0, y: 1.1, z: 0 }, 1, 0, () => 9);
    expect(c.position.y).toBeCloseTo(9.2, 9);
  });

  it("is wider than chase: 80 degrees on a landscape screen, 70 on a portrait one", () => {
    expect(cockpitFov(1440 / 900)).toBe(80);
    expect(cockpitFov(390 / 844)).toBe(70);
  });
});
