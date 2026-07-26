import type { PlayerInput } from "@open-party-lab/game-core";

export interface DriftRacerDriveInput extends PlayerInput {
  type: "drive";
  steering: number;
  throttle: boolean;
  brake: boolean;
  drift: boolean;
  boost: boolean;
  fire: boolean;
}

export type DriftRacerInput = DriftRacerDriveInput;

export interface DriftRacerPoint {
  x: number;
  y: number;
}

export interface DriftRacerTrackPoint extends DriftRacerPoint {
  distance: number;
}

export interface DriftRacerControlState {
  steering: number;
  throttle: boolean;
  brake: boolean;
  drift: boolean;
  boost: boolean;
  fire: boolean;
}

/** Weapons that can be picked up from item boxes. */
export type DriftRacerWeaponKind = "rocket" | "homing" | "mine" | "oil" | "turbo" | "shield" | "shock";

/** A jump ramp on the track (take-off rising over `length` to `peak`). */
export interface DriftRacerRampState {
  startDistance: number;
  length: number;
  peak: number;
}

/** An item box on the track that grants a random weapon. */
export interface DriftRacerPickupState {
  id: string;
  x: number;
  y: number;
  active: boolean;
}

/** A live projectile (rocket flying forward, or a dropped mine). */
export interface DriftRacerProjectileState {
  id: string;
  kind: "rocket" | "homing" | "mine" | "oil";
  ownerId: string;
  x: number;
  y: number;
  z: number;
  angleRad: number;
  armed: boolean;
}

export interface DriftRacerRacerState {
  playerId: string;
  name: string;
  color: string;
  x: number;
  y: number;
  /** Height above the ground plane, in world units (0 = on the road). */
  z: number;
  /** Vertical velocity, used for jump animation (pitch). */
  vz: number;
  /** True while the car is in the air after a ramp. */
  airborne: boolean;
  angleRad: number;
  speed: number;
  lap: number;
  lapProgress: number;
  totalProgress: number;
  rank: number;
  finished: boolean;
  finishMs: number | null;
  offTrack: boolean;
  drifting: boolean;
  boostFuel: number;
  boostActive: boolean;
  steerInput: number;
  /** Held weapon from a pickup, or null. */
  weapon: DriftRacerWeaponKind | null;
  /** True while spun out after a weapon hit. */
  spunOut: boolean;
  /** Shield absorbs the next hit. */
  shielded: boolean;
  /** True for AI-controlled opponents. */
  isBot: boolean;
  /** Player currently locked on by the held weapon (aim assist), if any. */
  lockedTargetId: string | null;
}

export interface DriftRacerState {
  trackId: string;
  trackName: string;
  worldWidth: number;
  worldHeight: number;
  trackWidth: number;
  trackLength: number;
  wallHeight: number;
  lapsToWin: number;
  maxRaceMs: number;
  elapsedMs: number;
  tick: number;
  winnerPlayerId?: string;
  winnerName?: string;
  isTimedOut: boolean;
  track: DriftRacerTrackPoint[];
  ramps: DriftRacerRampState[];
  pickups: DriftRacerPickupState[];
  projectiles: DriftRacerProjectileState[];
  racers: DriftRacerRacerState[];
}
