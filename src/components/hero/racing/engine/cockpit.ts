/**
 * The cockpit camera: rigid on the car's
 * body. The eye (the car's eyeX/Y/Z, cars.ts) is turned into a world pose by the same two rotations
 * the model itself carries: the road's slope and the car's heading (carPose's roll and pitch), then
 * the body's own sway (bodyPose), damped to a third under reduced motion. No easing and no
 * shake: the eye is exactly where the body puts it every frame, so switching view is instant.
 */
import * as THREE from "three";

/** Turns the car's local +x (forward) into the camera's own -z (its look direction). */
const eyeYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2);
const eyeQ = new THREE.Quaternion(), bodyQ = new THREE.Quaternion(), eyeOff = new THREE.Vector3(), EU = new THREE.Euler();

interface Angles { roll: number; pitch: number }

/**
 * Poses cam at the eye. G: the car (position, heading h, ride height y); road: this frame's carPose
 * roll and pitch; body: bodyPose's sway; eye: the car's eye offset in metres; damp: 1, or 1/3 under
 * reduced motion; bump: the road's small lift here; floorAt(x, z): the surface height under the eye.
 */
export function cockpitPose(
  cam: { position: THREE.Vector3; quaternion: THREE.Quaternion },
  G: { pos: THREE.Vector3; h: number; y: number },
  road: Angles,
  body: Angles,
  eye: { x: number; y: number; z: number },
  damp: number,
  bump: number,
  floorAt: (x: number, z: number) => number,
): void {
  eyeQ.setFromEuler(EU.set(-road.roll, -G.h, road.pitch, "YZX"));
  bodyQ.setFromEuler(EU.set(body.roll * damp, 0, body.pitch * damp, "XYZ"));
  eyeQ.multiply(bodyQ); // the eye's full world rotation: the road and heading, then the body's own sway
  eyeOff.set(eye.x, eye.y, eye.z).applyQuaternion(eyeQ);
  cam.position.set(G.pos.x + eyeOff.x, G.y + bump + eyeOff.y, G.pos.z + eyeOff.z);
  // Never under the road or land, measured at the eye.
  const floor = floorAt(cam.position.x, cam.position.z) + 0.2;
  if (cam.position.y < floor) cam.position.y = floor;
  cam.quaternion.copy(eyeQ).multiply(eyeYaw);
}

/** Wider than chase, capped further on a portrait screen. */
export const cockpitFov = (aspect: number) => (aspect < 1 ? 70 : 80);
