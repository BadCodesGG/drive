/**
 * The two drivable cars: metres, seconds and m/s at true scale, every force per unit mass.
 */
export interface Car {
  len: number; wid: number; wb: number; tw: number; power: number; trac: number; cd: number; brake: number; brakeMax: number; brakeStopped: number;
  vMax: number; vMin: number; grip: number; aero: number; rearGrip: number; cf: number; cr: number; lock: number; limit: number; steerRate: number;
  assist: number; wallGrip: number; grass: number; slip: number; roll: number; pitch: number; susp: number; eyeX: number; eyeY: number; eyeZ: number;
}

export const CAR_IDS = ["gt3", "f1"] as const;
export type CarId = (typeof CAR_IDS)[number];
export const isCarId = (v: unknown): v is CarId => typeof v === "string" && (CAR_IDS as readonly string[]).includes(v);

export const CARS: Record<CarId, Car> = {
  gt3: { len: 4.5, wid: 1.95, wb: 2.6, tw: 1.52, power: 205, trac: 0.82, cd: 0.000406, brake: 1.75, brakeMax: 17.2, brakeStopped: 4, vMax: 82, vMin: -8, grip: 1.8, aero: 0.0004, rearGrip: 1.06, cf: 140, cr: 160, lock: 0.55, limit: 1.0, steerRate: 5, assist: 8, wallGrip: 1.0, grass: 0.5, slip: 0.06, roll: 0.75, pitch: 0.6, susp: 0.08, eyeX: 0.4, eyeY: 1.1, eyeZ: -0.25 },
  f1: { len: 5.6, wid: 2.0, wb: 3.5, tw: 1.66, power: 790, trac: 0.95, cd: 0.00094, brake: 1.27, brakeMax: 41, brakeStopped: 5, vMax: 97, vMin: -7, grip: 1.5, aero: 0.0046, rearGrip: 1.12, cf: 240, cr: 270, lock: 0.8, limit: 1.3, steerRate: 10, assist: 10, wallGrip: 1.3, grass: 0.4, slip: 0.05, roll: 0.1, pitch: 0.07, susp: 0.04, eyeX: -0.15, eyeY: 0.95, eyeZ: 0 },
};
