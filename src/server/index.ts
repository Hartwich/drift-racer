import {
  createBaseRoundState,
  resolveRoundPhaseTimings,
  transitionRoundState,
  type GamePlayerSummary,
  type ScoreEntry,
  type ServerGame,
  type ServerGameContext
} from "@open-party-lab/game-core";
import type {
  DriftRacerControlState,
  DriftRacerInput,
  DriftRacerProjectileState,
  DriftRacerRacerState,
  DriftRacerState,
  DriftRacerWeaponKind
} from "../protocol.js";
import { driftRacerManifest } from "../manifest.js";
import {
  driftRacerPickups,
  driftRacerRamps,
  driftRacerTrack,
  driftRacerTrackConfig,
  projectPointToDriftRacerTrack,
  sampleDriftRacerTrack,
  sampleRampHeight
} from "./driftRacerTrack.js";
import type {
  DriftRacerRuntimePickup,
  DriftRacerRuntimeProjectile,
  DriftRacerRuntimeRacerState,
  DriftRacerRuntimeState
} from "./driftRacerState.js";

const phaseTimings = resolveRoundPhaseTimings(driftRacerManifest.phaseDurations);
const acceleration = 660;
const brakeAcceleration = 920;
const reverseAcceleration = 350;
const rollingDrag = 1.05;
const offTrackDrag = 2.55;
const maxForwardSpeed = 780;
const maxBoostSpeed = 1_040;
const maxOffTrackSpeed = 390;
const maxReverseSpeed = -170;
const steeringRate = 2.45;
const driftSteeringRate = 3.2;
const driftFuelGainPerSecond = 0.28;
const boostFuelUsePerSecond = 0.56;
const boostAcceleration = 920;

// Vertical / track-interaction tuning.
const gravity = 760;
const jumpFactor = 1.5;
const minJumpSpeed = 240;
const airSteerFactor = 0.35;
const wallMaxScrub = 0.5;

// Weapon tuning.
const weaponCooldownMs = 300;
const rocketSpeed = 1_020;
const rocketTtlMs = 2_200;
const rocketHitRadius = 50;
const mineTtlMs = 12_000;
const mineArmMs = 700;
const mineHitRadius = 48;
const turboDurationMs = 1_600;
const stunDurationMs = 1_500;
const stunSpinRate = 14;
const pickupRadius = 52;
const pickupRespawnMs = 5_000;
const weaponKinds: DriftRacerWeaponKind[] = ["rocket", "rocket", "mine", "turbo"];

const neutralControls: DriftRacerControlState = {
  steering: 0,
  throttle: false,
  brake: false,
  drift: false,
  boost: false,
  fire: false
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeAngle(angleRad: number): number {
  const fullCircle = Math.PI * 2;
  const normalized = angleRad % fullCircle;
  return normalized >= -Math.PI ? normalized : normalized + fullCircle;
}

function getPlayers(context: ServerGameContext): GamePlayerSummary[] {
  if (context.players.length > 0) {
    return context.players.slice(0, 4);
  }

  return [
    {
      id: "drift-racer-player",
      name: "Player",
      color: "#22d3ee",
      score: 0,
      isReady: true,
      connected: true
    }
  ];
}

function createRacers(context: ServerGameContext): DriftRacerRuntimeRacerState[] {
  const players = getPlayers(context);
  const laneOffsets = [-0.24, 0.24, -0.08, 0.08];

  return players.map((player, index) => {
    const row = Math.floor(index / 2);
    const startDistance = 110 + row * 92;
    const sample = sampleDriftRacerTrack(startDistance);
    const laneOffset = laneOffsets[index] * driftRacerTrackConfig.trackWidth;
    const x = sample.x + sample.normalX * laneOffset;
    const y = sample.y + sample.normalY * laneOffset;

    return {
      playerId: player.id,
      name: player.name,
      color: player.color,
      x,
      y,
      z: 0,
      vz: 0,
      airborne: false,
      angleRad: sample.angleRad,
      speed: 0,
      lap: 0,
      lapProgress: startDistance,
      previousLapProgress: startDistance,
      totalProgress: startDistance,
      rank: index + 1,
      finished: false,
      finishMs: null,
      finishOrder: null,
      offTrack: false,
      drifting: false,
      boostFuel: 0.35,
      boostActive: false,
      steerInput: 0,
      weapon: null,
      spunOut: false,
      controls: neutralControls,
      lastInputAt: context.now,
      firePrev: false,
      stunnedMs: 0,
      weaponCooldownMs: 0,
      turboMs: 0
    };
  });
}

function createPickups(): DriftRacerRuntimePickup[] {
  return driftRacerPickups.map((pickup) => ({
    id: pickup.id,
    x: pickup.x,
    y: pickup.y,
    active: true,
    respawnMs: 0
  }));
}

function toPublicRacer(racer: DriftRacerRuntimeRacerState): DriftRacerRacerState {
  return {
    playerId: racer.playerId,
    name: racer.name,
    color: racer.color,
    x: racer.x,
    y: racer.y,
    z: racer.z,
    vz: racer.vz,
    airborne: racer.airborne,
    angleRad: racer.angleRad,
    speed: racer.speed,
    lap: racer.lap,
    lapProgress: racer.lapProgress,
    totalProgress: racer.totalProgress,
    rank: racer.rank,
    finished: racer.finished,
    finishMs: racer.finishMs,
    offTrack: racer.offTrack,
    drifting: racer.drifting,
    boostFuel: racer.boostFuel,
    boostActive: racer.boostActive,
    steerInput: racer.steerInput,
    weapon: racer.weapon,
    spunOut: racer.spunOut
  };
}

function sortRacersForRank(racers: DriftRacerRuntimeRacerState[]): DriftRacerRuntimeRacerState[] {
  return [...racers].sort((a, b) => {
    if (a.finished && b.finished) {
      return (a.finishOrder ?? 999) - (b.finishOrder ?? 999);
    }
    if (a.finished !== b.finished) {
      return a.finished ? -1 : 1;
    }
    return b.totalProgress - a.totalProgress;
  });
}

function assignRanks(racers: DriftRacerRuntimeRacerState[]): DriftRacerRuntimeRacerState[] {
  const rankByPlayerId = new Map<string, number>();
  sortRacersForRank(racers).forEach((racer, index) => {
    rankByPlayerId.set(racer.playerId, index + 1);
  });
  return racers.map((racer) => ({
    ...racer,
    rank: rankByPlayerId.get(racer.playerId) ?? racer.rank
  }));
}

function updateRacerProgress(
  racer: DriftRacerRuntimeRacerState,
  elapsedMs: number,
  nextFinishOrder: number
): { racer: DriftRacerRuntimeRacerState; nextFinishOrder: number } {
  const projection = projectPointToDriftRacerTrack(racer.x, racer.y);
  const lapProgress = projection.distance;
  const crossedForward =
    racer.previousLapProgress > driftRacerTrack.length * 0.78 &&
    lapProgress < driftRacerTrack.length * 0.22 &&
    racer.speed > 70;
  const crossedBackward =
    racer.previousLapProgress < driftRacerTrack.length * 0.18 &&
    lapProgress > driftRacerTrack.length * 0.82 &&
    racer.speed < -55;
  const lap = crossedForward
    ? racer.lap + 1
    : crossedBackward
      ? Math.max(0, racer.lap - 1)
      : racer.lap;
  const finished = racer.finished || lap >= driftRacerTrackConfig.lapsToWin;
  const finishOrder = finished && racer.finishOrder === null ? nextFinishOrder : racer.finishOrder;
  const finishMs = finished && racer.finishMs === null ? elapsedMs : racer.finishMs;

  return {
    racer: {
      ...racer,
      lap,
      lapProgress,
      previousLapProgress: lapProgress,
      totalProgress: lap * driftRacerTrack.length + lapProgress,
      finished,
      finishOrder,
      finishMs,
      offTrack: projection.lateralDistance > driftRacerTrackConfig.trackWidth * 0.5
    },
    nextFinishOrder: finished && racer.finishOrder === null ? nextFinishOrder + 1 : nextFinishOrder
  };
}

function simulateRacer(
  racer: DriftRacerRuntimeRacerState,
  deltaMs: number,
  connected: boolean
): DriftRacerRuntimeRacerState {
  if (racer.finished) {
    return {
      ...racer,
      controls: neutralControls,
      speed: racer.speed * 0.96,
      boostActive: false,
      drifting: false,
      steerInput: 0,
      spunOut: false
    };
  }

  const seconds = Math.max(0.001, deltaMs / 1000);

  // Spun out after a weapon hit: no control, spin in place, bleed speed.
  if (racer.stunnedMs > 0) {
    const stunnedMs = Math.max(0, racer.stunnedMs - deltaMs);
    return {
      ...racer,
      controls: connected ? racer.controls : neutralControls,
      speed: racer.speed * Math.max(0, 1 - 1.6 * seconds),
      angleRad: normalizeAngle(racer.angleRad + stunSpinRate * seconds),
      stunnedMs,
      spunOut: stunnedMs > 0,
      drifting: false,
      boostActive: false,
      steerInput: 0
    };
  }

  const controls = connected ? racer.controls : neutralControls;
  const steering = clamp(controls.steering, -1, 1);
  const airborne = racer.airborne;
  const turbo = racer.turboMs > 0;
  const turboMs = Math.max(0, racer.turboMs - deltaMs);
  const driftRequested =
    !airborne && controls.drift && Math.abs(steering) > 0.12 && racer.speed > 170;
  const boostActive = turbo || (controls.boost && racer.boostFuel > 0.02 && racer.speed > 80);
  const effectiveOffTrack = racer.offTrack && !airborne;
  const maxSpeed = effectiveOffTrack
    ? maxOffTrackSpeed
    : boostActive
      ? maxBoostSpeed
      : maxForwardSpeed;
  let speed = racer.speed;

  if (controls.throttle) {
    speed += acceleration * seconds;
  }
  if (controls.brake) {
    speed += speed > 20 ? -brakeAcceleration * seconds : -reverseAcceleration * seconds;
  }
  speed -= speed * (effectiveOffTrack ? offTrackDrag : rollingDrag) * seconds;
  if (boostActive) {
    speed += boostAcceleration * seconds;
  }
  if (driftRequested) {
    speed -= Math.max(0, speed) * 0.34 * seconds;
  }
  speed = clamp(speed, maxReverseSpeed, maxSpeed);

  const speedFactor = clamp(Math.abs(speed) / 300, 0, 1);
  const turnRate = (driftRequested ? driftSteeringRate : steeringRate) * (airborne ? airSteerFactor : 1);
  const directionSign = speed >= 0 ? 1 : -1;
  const angleRad = normalizeAngle(
    racer.angleRad + steering * turnRate * speedFactor * directionSign * seconds
  );
  const slideAngle = driftRequested ? steering * 0.34 * speedFactor : 0;
  const moveAngle = angleRad + slideAngle;
  const x = clamp(
    racer.x + Math.cos(moveAngle) * speed * seconds,
    driftRacerTrackConfig.carRadius,
    driftRacerTrackConfig.worldWidth - driftRacerTrackConfig.carRadius
  );
  const y = clamp(
    racer.y + Math.sin(moveAngle) * speed * seconds,
    driftRacerTrackConfig.carRadius,
    driftRacerTrackConfig.worldHeight - driftRacerTrackConfig.carRadius
  );
  const boostFuel = clamp(
    racer.boostFuel +
      (driftRequested && !racer.offTrack ? driftFuelGainPerSecond * seconds : 0) -
      (boostActive && !turbo ? boostFuelUsePerSecond * seconds : 0),
    0,
    1
  );

  return {
    ...racer,
    controls,
    x,
    y,
    angleRad,
    speed,
    drifting: driftRequested,
    boostActive,
    boostFuel,
    steerInput: steering,
    turboMs,
    spunOut: false
  };
}

function resolveTrackInteractions(
  racer: DriftRacerRuntimeRacerState,
  deltaMs: number
): DriftRacerRuntimeRacerState {
  const seconds = Math.max(0.001, deltaMs / 1000);
  let x = racer.x;
  let y = racer.y;
  let z = racer.z;
  let vz = racer.vz;
  let airborne = racer.airborne;
  let speed = racer.speed;

  const projection = projectPointToDriftRacerTrack(x, y);
  const distance = projection.distance;

  if (!airborne) {
    const maxLateral = driftRacerTrackConfig.trackWidth * 0.5 - driftRacerTrackConfig.carRadius;
    if (projection.lateralDistance > maxLateral) {
      const sign = projection.signedLateralDistance >= 0 ? 1 : -1;
      const over = projection.lateralDistance - maxLateral;
      x -= projection.normalX * sign * over;
      y -= projection.normalY * sign * over;
      const hit = Math.min(1, over / driftRacerTrackConfig.carRadius);
      speed *= 1 - wallMaxScrub * hit;
    }
  }

  if (airborne) {
    z += vz * seconds;
    vz -= gravity * seconds;
    const ground = sampleRampHeight(distance).height;
    if (z <= ground) {
      z = ground;
      vz = 0;
      airborne = false;
    }
  } else {
    const ramp = sampleRampHeight(distance);
    const ahead = sampleRampHeight(distance + Math.max(0, speed) * seconds);
    if (ramp.height > 1 && ahead.height < ramp.height && speed > minJumpSpeed) {
      z = ramp.height;
      vz = speed * ramp.slope * jumpFactor;
      airborne = true;
    } else {
      z = ramp.height;
      vz = 0;
    }
  }

  return { ...racer, x, y, z, vz, airborne, speed };
}

function resolveRacerBumps(racers: DriftRacerRuntimeRacerState[]): DriftRacerRuntimeRacerState[] {
  const nextRacers = racers.map((racer) => ({ ...racer }));
  const minDistance = driftRacerTrackConfig.carRadius * 1.9;
  const restitution = 0.28;

  for (let firstIndex = 0; firstIndex < nextRacers.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < nextRacers.length; secondIndex += 1) {
      const first = nextRacers[firstIndex];
      const second = nextRacers[secondIndex];
      // Cars at very different heights (one mid-jump) do not collide.
      if (Math.abs(first.z - second.z) > driftRacerTrackConfig.carRadius * 1.4) {
        continue;
      }
      const dx = second.x - first.x;
      const dy = second.y - first.y;
      const distance = Math.hypot(dx, dy);
      if (distance <= 0.001 || distance >= minDistance) {
        continue;
      }

      const nx = dx / distance;
      const ny = dy / distance;
      const overlap = minDistance - distance;

      // Positional separation weighted by speed: the faster car shoves the
      // slower one more (so ramming pushes the target off its line).
      const s1 = Math.abs(first.speed);
      const s2 = Math.abs(second.speed);
      const total = s1 + s2 + 1;
      const push1 = overlap * (s2 / total);
      const push2 = overlap * (s1 / total);
      first.x = clamp(first.x - nx * push1, driftRacerTrackConfig.carRadius, driftRacerTrackConfig.worldWidth - driftRacerTrackConfig.carRadius);
      first.y = clamp(first.y - ny * push1, driftRacerTrackConfig.carRadius, driftRacerTrackConfig.worldHeight - driftRacerTrackConfig.carRadius);
      second.x = clamp(second.x + nx * push2, driftRacerTrackConfig.carRadius, driftRacerTrackConfig.worldWidth - driftRacerTrackConfig.carRadius);
      second.y = clamp(second.y + ny * push2, driftRacerTrackConfig.carRadius, driftRacerTrackConfig.worldHeight - driftRacerTrackConfig.carRadius);

      // Momentum impulse along the contact normal (treat each car's velocity as
      // speed along its heading), so a rear-end ram transfers speed forward.
      const v1x = Math.cos(first.angleRad) * first.speed;
      const v1y = Math.sin(first.angleRad) * first.speed;
      const v2x = Math.cos(second.angleRad) * second.speed;
      const v2y = Math.sin(second.angleRad) * second.speed;
      const relNormal = (v2x - v1x) * nx + (v2y - v1y) * ny;
      if (relNormal < 0) {
        const impulse = (-(1 + restitution) * relNormal) / 2;
        const n1x = v1x - impulse * nx;
        const n1y = v1y - impulse * ny;
        const n2x = v2x + impulse * nx;
        const n2y = v2y + impulse * ny;
        first.speed = clamp(n1x * Math.cos(first.angleRad) + n1y * Math.sin(first.angleRad), maxReverseSpeed, maxBoostSpeed);
        second.speed = clamp(n2x * Math.cos(second.angleRad) + n2y * Math.sin(second.angleRad), maxReverseSpeed, maxBoostSpeed);
      }
    }
  }

  return nextRacers;
}

interface WeaponUpdate {
  racers: DriftRacerRuntimeRacerState[];
  projectiles: DriftRacerRuntimeProjectile[];
  pickups: DriftRacerRuntimePickup[];
  nextProjectileId: number;
}

function updateWeapons(
  state: DriftRacerRuntimeState,
  inputRacers: DriftRacerRuntimeRacerState[],
  deltaMs: number
): WeaponUpdate {
  const racers = inputRacers.map((racer) => ({ ...racer }));
  let nextProjectileId = state.nextProjectileId;
  const projectiles: DriftRacerRuntimeProjectile[] = state.projectiles.map((p) => ({ ...p }));

  // Pickups: respawn timers + collection.
  const pickups = state.pickups.map((pickup) => {
    let active = pickup.active;
    let respawnMs = pickup.respawnMs;
    if (!active) {
      respawnMs = Math.max(0, respawnMs - deltaMs);
      if (respawnMs === 0) {
        active = true;
      }
    }
    return { ...pickup, active, respawnMs };
  });

  for (const racer of racers) {
    if (racer.finished || racer.stunnedMs > 0 || racer.weapon !== null) {
      continue;
    }
    for (const pickup of pickups) {
      if (!pickup.active) {
        continue;
      }
      if (Math.hypot(pickup.x - racer.x, pickup.y - racer.y) < pickupRadius) {
        racer.weapon = weaponKinds[Math.floor(Math.random() * weaponKinds.length)];
        pickup.active = false;
        pickup.respawnMs = pickupRespawnMs;
        break;
      }
    }
  }

  // Firing (rising edge of the fire button).
  for (const racer of racers) {
    const firePressed = racer.controls.fire === true;
    const edge = firePressed && !racer.firePrev;
    racer.firePrev = firePressed;
    racer.weaponCooldownMs = Math.max(0, racer.weaponCooldownMs - deltaMs);

    if (!edge || racer.finished || racer.stunnedMs > 0 || racer.weaponCooldownMs > 0 || !racer.weapon) {
      continue;
    }

    const weapon = racer.weapon;
    racer.weapon = null;
    racer.weaponCooldownMs = weaponCooldownMs;
    const cos = Math.cos(racer.angleRad);
    const sin = Math.sin(racer.angleRad);

    if (weapon === "rocket") {
      projectiles.push({
        id: `proj-${nextProjectileId}`,
        kind: "rocket",
        ownerId: racer.playerId,
        x: racer.x + cos * driftRacerTrackConfig.carRadius * 1.6,
        y: racer.y + sin * driftRacerTrackConfig.carRadius * 1.6,
        z: 20,
        angleRad: racer.angleRad,
        armed: true,
        vx: cos * rocketSpeed,
        vy: sin * rocketSpeed,
        ttlMs: rocketTtlMs,
        armDelayMs: 0
      });
      nextProjectileId += 1;
    } else if (weapon === "mine") {
      projectiles.push({
        id: `proj-${nextProjectileId}`,
        kind: "mine",
        ownerId: racer.playerId,
        x: racer.x - cos * driftRacerTrackConfig.carRadius * 1.6,
        y: racer.y - sin * driftRacerTrackConfig.carRadius * 1.6,
        z: 6,
        angleRad: racer.angleRad,
        armed: false,
        vx: 0,
        vy: 0,
        ttlMs: mineTtlMs,
        armDelayMs: mineArmMs
      });
      nextProjectileId += 1;
    } else if (weapon === "turbo") {
      racer.turboMs = turboDurationMs;
      racer.boostFuel = 1;
    }
  }

  // Advance projectiles and resolve hits.
  const seconds = deltaMs / 1000;
  const survivors: DriftRacerRuntimeProjectile[] = [];
  for (const projectile of projectiles) {
    let { x, y, ttlMs, armDelayMs, armed } = projectile;
    if (projectile.kind === "rocket") {
      x += projectile.vx * seconds;
      y += projectile.vy * seconds;
    } else {
      armDelayMs = Math.max(0, armDelayMs - deltaMs);
      armed = armDelayMs === 0;
    }
    ttlMs -= deltaMs;

    let dead = ttlMs <= 0;

    if (projectile.kind === "rocket") {
      const projection = projectPointToDriftRacerTrack(x, y);
      if (projection.lateralDistance > driftRacerTrackConfig.trackWidth * 0.6) {
        dead = true;
      }
    }

    if (!dead && armed) {
      for (const racer of racers) {
        if (racer.playerId === projectile.ownerId || racer.finished || racer.stunnedMs > 0) {
          continue;
        }
        const hitRadius = projectile.kind === "rocket" ? rocketHitRadius : mineHitRadius;
        if (Math.hypot(racer.x - x, racer.y - y) < hitRadius) {
          racer.stunnedMs = stunDurationMs;
          racer.spunOut = true;
          racer.speed *= 0.35;
          racer.turboMs = 0;
          dead = true;
          break;
        }
      }
    }

    if (!dead) {
      survivors.push({ ...projectile, x, y, ttlMs, armDelayMs, armed });
    }
  }

  return { racers, projectiles: survivors, pickups, nextProjectileId };
}

function buildRaceMessage(state: DriftRacerRuntimeState, language: ServerGameContext["language"]): string {
  const leader = sortRacersForRank(state.racers)[0];
  if (!leader) {
    return language === "en" ? "Race finished." : "Rennen beendet.";
  }
  if (state.isTimedOut) {
    return language === "en"
      ? `${leader.name} leads at the time limit.`
      : `${leader.name} fuehrt beim Zeitlimit.`;
  }
  return language === "en" ? `${leader.name} reaches the finish.` : `${leader.name} erreicht das Ziel.`;
}

function tickRace(
  state: DriftRacerRuntimeState,
  deltaMs: number,
  context: ServerGameContext
): DriftRacerRuntimeState {
  const connectedByPlayerId = new Map(context.players.map((player) => [player.id, player.connected]));
  let racers = state.racers.map((racer) =>
    simulateRacer(racer, deltaMs, connectedByPlayerId.get(racer.playerId) !== false)
  );

  racers = resolveRacerBumps(racers);
  racers = racers.map((racer) => resolveTrackInteractions(racer, deltaMs));

  const weapons = updateWeapons(state, racers, deltaMs);
  racers = weapons.racers;

  let nextFinishOrder = state.nextFinishOrder;
  const elapsedMs = Math.min(state.maxRaceMs, state.elapsedMs + deltaMs);
  racers = racers.map((racer) => {
    const progressUpdate = updateRacerProgress(racer, elapsedMs, nextFinishOrder);
    nextFinishOrder = progressUpdate.nextFinishOrder;
    return progressUpdate.racer;
  });
  racers = assignRanks(racers);

  const allFinished = racers.length > 0 && racers.every((racer) => racer.finished);
  const isTimedOut = elapsedMs >= state.maxRaceMs;
  const leader = sortRacersForRank(racers)[0];

  return {
    ...state,
    racers,
    projectiles: weapons.projectiles,
    pickups: weapons.pickups,
    nextProjectileId: weapons.nextProjectileId,
    elapsedMs,
    tick: state.tick + 1,
    nextFinishOrder,
    isTimedOut,
    winnerPlayerId: allFinished || isTimedOut ? leader?.playerId : state.winnerPlayerId,
    winnerName: allFinished || isTimedOut ? leader?.name : state.winnerName,
    updatedAt: context.now,
    message: allFinished || isTimedOut ? buildRaceMessage({ ...state, racers, isTimedOut }, context.language) : state.message
  };
}

function toPublicProjectile(projectile: DriftRacerRuntimeProjectile): DriftRacerProjectileState {
  return {
    id: projectile.id,
    kind: projectile.kind,
    ownerId: projectile.ownerId,
    x: projectile.x,
    y: projectile.y,
    z: projectile.z,
    angleRad: projectile.angleRad,
    armed: projectile.armed
  };
}

function buildPublicState(state: DriftRacerRuntimeState): DriftRacerState {
  return {
    worldWidth: state.worldWidth,
    worldHeight: state.worldHeight,
    trackWidth: state.trackWidth,
    trackLength: state.trackLength,
    wallHeight: state.wallHeight,
    lapsToWin: state.lapsToWin,
    maxRaceMs: state.maxRaceMs,
    elapsedMs: state.elapsedMs,
    tick: state.tick,
    winnerPlayerId: state.winnerPlayerId,
    winnerName: state.winnerName,
    isTimedOut: state.isTimedOut,
    track: state.track,
    ramps: state.ramps,
    pickups: state.pickups.map((pickup) => ({ id: pickup.id, x: pickup.x, y: pickup.y, active: pickup.active })),
    projectiles: state.projectiles.map(toPublicProjectile),
    racers: state.racers.map(toPublicRacer)
  };
}

function buildScore(state: DriftRacerRuntimeState): ScoreEntry[] {
  const racerCount = state.racers.length;
  return sortRacersForRank(state.racers).map((racer, index) => ({
    playerId: racer.playerId,
    delta: Math.max(1, racerCount - index),
    reason: index === 0 ? "Drift Racer Sieg" : "Drift Racer Platzierung"
  }));
}

export const serverGame: ServerGame<
  DriftRacerRuntimeState,
  DriftRacerInput,
  DriftRacerState
> = {
  manifest: driftRacerManifest,
  createInitialState(context) {
    return {
      ...createBaseRoundState("round_intro", context.now, {
        durationMs: phaseTimings.roundIntroMs,
        message: context.language === "en" ? "Engines warming up." : "Motoren laufen warm."
      }),
      worldWidth: driftRacerTrackConfig.worldWidth,
      worldHeight: driftRacerTrackConfig.worldHeight,
      trackWidth: driftRacerTrackConfig.trackWidth,
      trackLength: driftRacerTrack.length,
      wallHeight: driftRacerTrackConfig.wallHeight,
      lapsToWin: driftRacerTrackConfig.lapsToWin,
      maxRaceMs: driftRacerTrackConfig.maxRaceMs,
      elapsedMs: 0,
      tick: 0,
      winnerPlayerId: undefined,
      winnerName: undefined,
      isTimedOut: false,
      track: driftRacerTrack.points,
      ramps: driftRacerRamps,
      pickups: createPickups(),
      projectiles: [],
      racers: assignRanks(createRacers(context)),
      nextFinishOrder: 1,
      nextProjectileId: 1
    };
  },
  startRound(_state, context) {
    return transitionRoundState(
      {
        ..._state,
        elapsedMs: 0,
        tick: 0,
        winnerPlayerId: undefined,
        winnerName: undefined,
        isTimedOut: false,
        racers: assignRanks(createRacers(context)),
        pickups: createPickups(),
        projectiles: [],
        nextFinishOrder: 1,
        nextProjectileId: 1
      },
      "playing",
      context.now,
      {
        startedAt: context.now,
        message: context.language === "en" ? "Race is live." : "Das Rennen laeuft."
      }
    );
  },
  handleInput(state, input, context) {
    if (input.type !== "drive" || state.phase !== "playing") {
      return state;
    }
    const racerIndex = state.racers.findIndex((racer) => racer.playerId === input.playerId);
    if (racerIndex === -1) {
      return state;
    }
    const racers = [...state.racers];
    const racer = racers[racerIndex];
    racers[racerIndex] = {
      ...racer,
      controls: {
        steering: clamp(input.steering, -1, 1),
        throttle: Boolean(input.throttle),
        brake: Boolean(input.brake),
        drift: Boolean(input.drift),
        boost: Boolean(input.boost),
        fire: Boolean(input.fire)
      },
      lastInputAt: input.sentAt ?? context.now
    };
    return {
      ...state,
      racers,
      updatedAt: input.sentAt ?? context.now
    };
  },
  tick(state, deltaMs, context) {
    if (state.phase !== "playing") {
      return state;
    }
    return tickRace(state, deltaMs, context);
  },
  isRoundFinished(state) {
    return (
      state.phase === "locked" ||
      state.isTimedOut ||
      (state.racers.length > 0 && state.racers.every((racer) => racer.finished))
    );
  },
  buildScore(state) {
    return buildScore(state);
  },
  toPublicState(state) {
    return buildPublicState(state);
  },
  toControllerState(state) {
    return buildPublicState(state);
  }
};
