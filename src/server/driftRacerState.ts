import type { BaseRoundState } from "@open-party-lab/game-core";
import type {
  DriftRacerControlState,
  DriftRacerPickupState,
  DriftRacerProjectileState,
  DriftRacerRacerState,
  DriftRacerState
} from "../protocol.js";

export interface DriftRacerRuntimeRacerState extends DriftRacerRacerState {
  controls: DriftRacerControlState;
  previousLapProgress: number;
  lastInputAt: number;
  finishOrder: number | null;
  firePrev: boolean;
  stunnedMs: number;
  weaponCooldownMs: number;
  turboMs: number;
}

export interface DriftRacerRuntimeProjectile extends DriftRacerProjectileState {
  vx: number;
  vy: number;
  ttlMs: number;
  armDelayMs: number;
}

export interface DriftRacerRuntimePickup extends DriftRacerPickupState {
  respawnMs: number;
}

export interface DriftRacerRuntimeState
  extends BaseRoundState,
    Omit<DriftRacerState, "racers" | "projectiles" | "pickups"> {
  racers: DriftRacerRuntimeRacerState[];
  projectiles: DriftRacerRuntimeProjectile[];
  pickups: DriftRacerRuntimePickup[];
  nextFinishOrder: number;
  nextProjectileId: number;
}
