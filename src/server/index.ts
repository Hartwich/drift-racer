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
import { driftRacerManifest, driftRacerRoomSettingKeys } from "../manifest.js";
import {
  driftRacerTrackConfig,
  driftRacerTrackIds,
  getPickups,
  getRamps,
  getTrack,
  projectPointToDriftRacerTrack,
  sampleDriftRacerTrack,
  sampleRampHeight,
  setActiveDriftRacerTrack
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

// Vertical / track interaction.
const gravity = 760;
const jumpFactor = 1.5;
const minJumpSpeed = 240;
const airSteerFactor = 0.35;
const wallMaxScrub = 0.5;

// Weapons.
const weaponCooldownMs = 250;
const rocketSpeed = 1_120;
const rocketTtlMs = 2_600;
const rocketHitRadius = 52;
const homingSpeed = 900;
const homingTtlMs = 4_000;
const homingTurnRate = 3.4;
const mineTtlMs = 14_000;
const mineArmMs = 700;
const mineHitRadius = 48;
const oilTtlMs = 12_000;
const oilHitRadius = 62;
const turboDurationMs = 1_800;
const shockRange = 620;
const stunDurationMs = 1_500;
const stunSpinRate = 14;
const pickupRadius = 54;
const pickupRespawnMs = 5_000;
/** Aim assist: a rocket fired within this cone snaps onto the target. */
const aimAssistCone = 0.42;
const aimAssistRange = 1_400;

/** Weighted item pool, biased by how far behind the racer is. */
const frontItems: DriftRacerWeaponKind[] = ["rocket", "mine", "oil", "shield", "turbo"];
const backItems: DriftRacerWeaponKind[] = ["homing", "rocket", "shock", "turbo", "shield", "oil"];

const botNames = ["Turbo Tina", "Nitro Nick", "Sandy Sam", "Coco Kim", "Rex Rally"];
const botColors = ["#f97316", "#a855f7", "#14b8a6", "#eab308", "#ec4899"];
const minRacers = 4;

interface DriftRacerSettings {
  track: string;
  laps: number;
  bots: number;
}

function readSettings(context: ServerGameContext): DriftRacerSettings {
  const settings = context.roomSettings ?? {};
  const rawTrack = settings[driftRacerRoomSettingKeys.track];
  const track = typeof rawTrack === "string" && (rawTrack === "rotate" || driftRacerTrackIds.includes(rawTrack))
    ? rawTrack
    : "rotate";
  const rawLaps = settings[driftRacerRoomSettingKeys.laps];
  const laps = typeof rawLaps === "number" && Number.isFinite(rawLaps) ? clamp(Math.round(rawLaps), 1, 6) : driftRacerTrackConfig.lapsToWin;
  const rawBots = settings[driftRacerRoomSettingKeys.bots];
  const bots = typeof rawBots === "number" && Number.isFinite(rawBots) ? clamp(Math.round(rawBots), 0, 5) : 3;
  return { track, laps, bots };
}

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

function angleDelta(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function getPlayers(context: ServerGameContext): GamePlayerSummary[] {
  return context.players.slice(0, 4);
}

function createRacer(
  id: string,
  name: string,
  color: string,
  index: number,
  isBot: boolean,
  now: number
): DriftRacerRuntimeRacerState {
  const laneOffsets = [-0.26, 0.26, -0.09, 0.09, -0.18, 0.18];
  const row = Math.floor(index / 2);
  const startDistance = 130 + row * 96;
  const sample = sampleDriftRacerTrack(startDistance);
  const laneOffset = (laneOffsets[index % laneOffsets.length] ?? 0) * driftRacerTrackConfig.trackWidth;

  return {
    playerId: id,
    name,
    color,
    x: sample.x + sample.normalX * laneOffset,
    y: sample.y + sample.normalY * laneOffset,
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
    shielded: false,
    isBot,
    lockedTargetId: null,
    controls: neutralControls,
    lastInputAt: now,
    firePrev: false,
    stunnedMs: 0,
    weaponCooldownMs: 0,
    turboMs: 0,
    botAimAhead: 190,
    botSkill: isBot ? 0.82 + Math.random() * 0.16 : 1
  };
}

function createRacers(context: ServerGameContext, botCount: number): DriftRacerRuntimeRacerState[] {
  const players = getPlayers(context);
  const racers = players.map((player, index) =>
    createRacer(player.id, player.name, player.color, index, false, context.now)
  );

  // Add AI opponents (at least one rival when nobody else joined).
  const humans = racers.length;
  const bots = Math.max(botCount, humans === 1 ? Math.min(1, minRacers - 1) : 0);
  for (let i = humans; i < humans + bots; i += 1) {
    const botIndex = i - humans;
    racers.push(
      createRacer(
        `bot-${botIndex}`,
        botNames[botIndex % botNames.length],
        botColors[botIndex % botColors.length],
        i,
        true,
        context.now
      )
    );
  }
  return racers;
}

function createPickups(): DriftRacerRuntimePickup[] {
  return getPickups().map((pickup) => ({
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
    spunOut: racer.spunOut,
    shielded: racer.shielded,
    isBot: racer.isBot,
    lockedTargetId: racer.lockedTargetId
  };
}

function sortRacersForRank(racers: DriftRacerRuntimeRacerState[]): DriftRacerRuntimeRacerState[] {
  return [...racers].sort((a, b) => {
    if (a.finished && b.finished) return (a.finishOrder ?? 999) - (b.finishOrder ?? 999);
    if (a.finished !== b.finished) return a.finished ? -1 : 1;
    return b.totalProgress - a.totalProgress;
  });
}

function assignRanks(racers: DriftRacerRuntimeRacerState[]): DriftRacerRuntimeRacerState[] {
  const rankByPlayerId = new Map<string, number>();
  sortRacersForRank(racers).forEach((racer, index) => rankByPlayerId.set(racer.playerId, index + 1));
  return racers.map((racer) => ({ ...racer, rank: rankByPlayerId.get(racer.playerId) ?? racer.rank }));
}

function updateRacerProgress(
  racer: DriftRacerRuntimeRacerState,
  elapsedMs: number,
  nextFinishOrder: number,
  lapsToWin: number
): { racer: DriftRacerRuntimeRacerState; nextFinishOrder: number } {
  const track = getTrack();
  const projection = projectPointToDriftRacerTrack(racer.x, racer.y);
  const lapProgress = projection.distance;
  const crossedForward =
    racer.previousLapProgress > track.length * 0.78 && lapProgress < track.length * 0.22 && racer.speed > 70;
  const crossedBackward =
    racer.previousLapProgress < track.length * 0.18 && lapProgress > track.length * 0.82 && racer.speed < -55;
  const lap = crossedForward ? racer.lap + 1 : crossedBackward ? Math.max(0, racer.lap - 1) : racer.lap;
  const finished = racer.finished || lap >= lapsToWin;
  const finishOrder = finished && racer.finishOrder === null ? nextFinishOrder : racer.finishOrder;
  const finishMs = finished && racer.finishMs === null ? elapsedMs : racer.finishMs;

  return {
    racer: {
      ...racer,
      lap,
      lapProgress,
      previousLapProgress: lapProgress,
      totalProgress: lap * track.length + lapProgress,
      finished,
      finishOrder,
      finishMs,
      offTrack: projection.lateralDistance > driftRacerTrackConfig.trackWidth * 0.5
    },
    nextFinishOrder: finished && racer.finishOrder === null ? nextFinishOrder + 1 : nextFinishOrder
  };
}

/** Simple pure-pursuit AI: aim ahead on the racing line, brake for tight turns. */
function driveBot(racer: DriftRacerRuntimeRacerState): DriftRacerControlState {
  const projection = projectPointToDriftRacerTrack(racer.x, racer.y);
  const lookahead = racer.botAimAhead * (0.7 + 0.5 * racer.botSkill);
  const aim = sampleDriftRacerTrack(projection.distance + lookahead);
  const lane = Math.sin(projection.distance * 0.004) * 0.16 * driftRacerTrackConfig.trackWidth;
  const targetX = aim.x + aim.normalX * lane;
  const targetY = aim.y + aim.normalY * lane;
  const delta = angleDelta(racer.angleRad, Math.atan2(targetY - racer.y, targetX - racer.x));
  const steering = clamp(delta * 2.2, -1, 1);
  const sharp = Math.abs(delta) > 0.85;

  return {
    steering,
    throttle: true,
    brake: sharp && racer.speed > 540 * racer.botSkill,
    drift: sharp && racer.speed > 360,
    boost: !sharp && racer.boostFuel > 0.45 && racer.speed > 300,
    // Bots fire whenever they hold something; the edge detector handles rate.
    fire: racer.weapon !== null && !racer.firePrev
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

  if (racer.stunnedMs > 0) {
    const stunnedMs = Math.max(0, racer.stunnedMs - deltaMs);
    return {
      ...racer,
      speed: racer.speed * Math.max(0, 1 - 1.6 * seconds),
      angleRad: normalizeAngle(racer.angleRad + stunSpinRate * seconds),
      stunnedMs,
      spunOut: stunnedMs > 0,
      drifting: false,
      boostActive: false,
      steerInput: 0
    };
  }

  const controls = racer.isBot ? racer.controls : connected ? racer.controls : neutralControls;
  const steering = clamp(controls.steering, -1, 1);
  const airborne = racer.airborne;
  const turbo = racer.turboMs > 0;
  const turboMs = Math.max(0, racer.turboMs - deltaMs);
  const driftRequested = !airborne && controls.drift && Math.abs(steering) > 0.12 && racer.speed > 170;
  const boostActive = turbo || (controls.boost && racer.boostFuel > 0.02 && racer.speed > 80);
  const effectiveOffTrack = racer.offTrack && !airborne;
  const maxSpeed = effectiveOffTrack ? maxOffTrackSpeed : boostActive ? maxBoostSpeed : maxForwardSpeed;
  let speed = racer.speed;

  if (controls.throttle) speed += acceleration * seconds;
  if (controls.brake) speed += speed > 20 ? -brakeAcceleration * seconds : -reverseAcceleration * seconds;
  speed -= speed * (effectiveOffTrack ? offTrackDrag : rollingDrag) * seconds;
  if (boostActive) speed += boostAcceleration * seconds;
  if (driftRequested) speed -= Math.max(0, speed) * 0.34 * seconds;
  speed = clamp(speed, maxReverseSpeed, maxSpeed);

  const speedFactor = clamp(Math.abs(speed) / 300, 0, 1);
  const turnRate = (driftRequested ? driftSteeringRate : steeringRate) * (airborne ? airSteerFactor : 1);
  const directionSign = speed >= 0 ? 1 : -1;
  const angleRad = normalizeAngle(racer.angleRad + steering * turnRate * speedFactor * directionSign * seconds);
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
      speed *= 1 - wallMaxScrub * Math.min(1, over / driftRacerTrackConfig.carRadius);
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

  for (let i = 0; i < nextRacers.length; i += 1) {
    for (let j = i + 1; j < nextRacers.length; j += 1) {
      const first = nextRacers[i];
      const second = nextRacers[j];
      if (Math.abs(first.z - second.z) > driftRacerTrackConfig.carRadius * 1.4) continue;
      const dx = second.x - first.x;
      const dy = second.y - first.y;
      const distance = Math.hypot(dx, dy);
      if (distance <= 0.001 || distance >= minDistance) continue;

      const nx = dx / distance;
      const ny = dy / distance;
      const overlap = minDistance - distance;
      const s1 = Math.abs(first.speed);
      const s2 = Math.abs(second.speed);
      const total = s1 + s2 + 1;
      const push1 = overlap * (s2 / total);
      const push2 = overlap * (s1 / total);
      first.x = clamp(first.x - nx * push1, driftRacerTrackConfig.carRadius, driftRacerTrackConfig.worldWidth - driftRacerTrackConfig.carRadius);
      first.y = clamp(first.y - ny * push1, driftRacerTrackConfig.carRadius, driftRacerTrackConfig.worldHeight - driftRacerTrackConfig.carRadius);
      second.x = clamp(second.x + nx * push2, driftRacerTrackConfig.carRadius, driftRacerTrackConfig.worldWidth - driftRacerTrackConfig.carRadius);
      second.y = clamp(second.y + ny * push2, driftRacerTrackConfig.carRadius, driftRacerTrackConfig.worldHeight - driftRacerTrackConfig.carRadius);

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

/** Best target for the held weapon: nearest rival inside the forward cone. */
function findTarget(
  racer: DriftRacerRuntimeRacerState,
  racers: DriftRacerRuntimeRacerState[]
): DriftRacerRuntimeRacerState | null {
  let best: DriftRacerRuntimeRacerState | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const other of racers) {
    if (other.playerId === racer.playerId || other.finished) continue;
    const dx = other.x - racer.x;
    const dy = other.y - racer.y;
    const distance = Math.hypot(dx, dy);
    if (distance > aimAssistRange) continue;
    const off = Math.abs(angleDelta(racer.angleRad, Math.atan2(dy, dx)));
    if (off > aimAssistCone) continue;
    const score = distance * (1 + off);
    if (score < bestScore) {
      bestScore = score;
      best = other;
    }
  }
  return best;
}

function rollItem(racer: DriftRacerRuntimeRacerState, racerCount: number): DriftRacerWeaponKind {
  // Trailing racers get the punchier catch-up items.
  const behind = racer.rank > Math.ceil(racerCount / 2);
  const pool = behind ? backItems : frontItems;
  return pool[Math.floor(Math.random() * pool.length)];
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

  const pickups = state.pickups.map((pickup) => {
    let active = pickup.active;
    let respawnMs = pickup.respawnMs;
    if (!active) {
      respawnMs = Math.max(0, respawnMs - deltaMs);
      if (respawnMs === 0) active = true;
    }
    return { ...pickup, active, respawnMs };
  });

  for (const racer of racers) {
    if (racer.finished || racer.stunnedMs > 0 || racer.weapon !== null) continue;
    for (const pickup of pickups) {
      if (!pickup.active) continue;
      if (Math.hypot(pickup.x - racer.x, pickup.y - racer.y) < pickupRadius) {
        racer.weapon = rollItem(racer, racers.length);
        pickup.active = false;
        pickup.respawnMs = pickupRespawnMs;
        break;
      }
    }
  }

  // Keep a live lock so the HUD can show who is in the crosshair.
  for (const racer of racers) {
    const target = racer.weapon && (racer.weapon === "rocket" || racer.weapon === "homing" || racer.weapon === "shock")
      ? findTarget(racer, racers)
      : null;
    racer.lockedTargetId = target ? target.playerId : null;
  }

  for (const racer of racers) {
    const firePressed = racer.controls.fire === true;
    const edge = firePressed && !racer.firePrev;
    racer.firePrev = firePressed;
    racer.weaponCooldownMs = Math.max(0, racer.weaponCooldownMs - deltaMs);

    if (!edge || racer.finished || racer.stunnedMs > 0 || racer.weaponCooldownMs > 0 || !racer.weapon) continue;

    const weapon = racer.weapon;
    racer.weapon = null;
    racer.weaponCooldownMs = weaponCooldownMs;
    const target = findTarget(racer, racers);

    if (weapon === "rocket" || weapon === "homing") {
      // Aim assist: launch straight at the locked target instead of the nose.
      const aimAngle = target
        ? Math.atan2(target.y - racer.y, target.x - racer.x)
        : racer.angleRad;
      const speed = weapon === "homing" ? homingSpeed : rocketSpeed;
      const cos = Math.cos(aimAngle);
      const sin = Math.sin(aimAngle);
      projectiles.push({
        id: `proj-${nextProjectileId}`,
        kind: weapon,
        ownerId: racer.playerId,
        x: racer.x + cos * driftRacerTrackConfig.carRadius * 1.7,
        y: racer.y + sin * driftRacerTrackConfig.carRadius * 1.7,
        z: 20,
        angleRad: aimAngle,
        armed: true,
        vx: cos * speed,
        vy: sin * speed,
        ttlMs: weapon === "homing" ? homingTtlMs : rocketTtlMs,
        armDelayMs: 0,
        targetId: weapon === "homing" ? (target ? target.playerId : null) : null
      });
      nextProjectileId += 1;
    } else if (weapon === "mine" || weapon === "oil") {
      const cos = Math.cos(racer.angleRad);
      const sin = Math.sin(racer.angleRad);
      projectiles.push({
        id: `proj-${nextProjectileId}`,
        kind: weapon,
        ownerId: racer.playerId,
        x: racer.x - cos * driftRacerTrackConfig.carRadius * 1.8,
        y: racer.y - sin * driftRacerTrackConfig.carRadius * 1.8,
        z: weapon === "mine" ? 6 : 2,
        angleRad: racer.angleRad,
        armed: weapon === "oil",
        vx: 0,
        vy: 0,
        ttlMs: weapon === "mine" ? mineTtlMs : oilTtlMs,
        armDelayMs: weapon === "mine" ? mineArmMs : 0,
        targetId: null
      });
      nextProjectileId += 1;
    } else if (weapon === "turbo") {
      racer.turboMs = turboDurationMs;
      racer.boostFuel = 1;
    } else if (weapon === "shield") {
      racer.shielded = true;
    } else if (weapon === "shock") {
      // Shockwave: spins out every rival within range that is ahead of us.
      for (const other of racers) {
        if (other.playerId === racer.playerId || other.finished || other.stunnedMs > 0) continue;
        if (other.totalProgress <= racer.totalProgress) continue;
        if (Math.hypot(other.x - racer.x, other.y - racer.y) > shockRange) continue;
        if (other.shielded) {
          other.shielded = false;
          continue;
        }
        other.stunnedMs = stunDurationMs * 0.8;
        other.spunOut = true;
        other.speed *= 0.45;
        other.turboMs = 0;
      }
    }
  }

  const seconds = deltaMs / 1000;
  const survivors: DriftRacerRuntimeProjectile[] = [];
  for (const projectile of projectiles) {
    let { x, y, ttlMs, armDelayMs, armed, vx, vy, angleRad } = projectile;

    if (projectile.kind === "rocket" || projectile.kind === "homing") {
      if (projectile.kind === "homing") {
        const target = racers.find((r) => r.playerId === projectile.targetId && !r.finished);
        if (target) {
          const desired = Math.atan2(target.y - y, target.x - x);
          angleRad = normalizeAngle(angleRad + clamp(angleDelta(angleRad, desired), -homingTurnRate * seconds, homingTurnRate * seconds));
          vx = Math.cos(angleRad) * homingSpeed;
          vy = Math.sin(angleRad) * homingSpeed;
        }
      }
      x += vx * seconds;
      y += vy * seconds;
    } else {
      armDelayMs = Math.max(0, armDelayMs - deltaMs);
      armed = armDelayMs === 0;
    }
    ttlMs -= deltaMs;

    let dead = ttlMs <= 0;
    if (projectile.kind === "rocket" || projectile.kind === "homing") {
      const projection = projectPointToDriftRacerTrack(x, y);
      if (projection.lateralDistance > driftRacerTrackConfig.trackWidth * 0.62) dead = true;
    }

    if (!dead && armed) {
      for (const racer of racers) {
        if (racer.playerId === projectile.ownerId || racer.finished || racer.stunnedMs > 0) continue;
        const hitRadius =
          projectile.kind === "rocket" || projectile.kind === "homing"
            ? rocketHitRadius
            : projectile.kind === "mine"
              ? mineHitRadius
              : oilHitRadius;
        if (Math.hypot(racer.x - x, racer.y - y) >= hitRadius) continue;

        if (racer.shielded) {
          racer.shielded = false;
        } else if (projectile.kind === "oil") {
          // Oil slick: a shorter spin, and it stays for the next victim.
          racer.stunnedMs = stunDurationMs * 0.7;
          racer.spunOut = true;
          racer.speed *= 0.6;
          survivors.push({ ...projectile, x, y, ttlMs, armDelayMs, armed, vx, vy, angleRad });
          dead = true;
          break;
        } else {
          racer.stunnedMs = stunDurationMs;
          racer.spunOut = true;
          racer.speed *= 0.35;
          racer.turboMs = 0;
        }
        dead = true;
        break;
      }
    }

    if (!dead) survivors.push({ ...projectile, x, y, ttlMs, armDelayMs, armed, vx, vy, angleRad });
  }

  return { racers, projectiles: survivors, pickups, nextProjectileId };
}

function buildRaceMessage(state: DriftRacerRuntimeState, language: ServerGameContext["language"]): string {
  const leader = sortRacersForRank(state.racers)[0];
  if (!leader) return language === "en" ? "Race finished." : "Rennen beendet.";
  if (state.isTimedOut) {
    return language === "en" ? `${leader.name} leads at the time limit.` : `${leader.name} fuehrt beim Zeitlimit.`;
  }
  return language === "en" ? `${leader.name} reaches the finish.` : `${leader.name} erreicht das Ziel.`;
}

function tickRace(
  state: DriftRacerRuntimeState,
  deltaMs: number,
  context: ServerGameContext
): DriftRacerRuntimeState {
  const connectedByPlayerId = new Map(context.players.map((player) => [player.id, player.connected]));

  // AI opponents pick their own controls before the shared physics step.
  let racers = state.racers.map((racer) =>
    racer.isBot && !racer.finished && racer.stunnedMs <= 0 ? { ...racer, controls: driveBot(racer) } : racer
  );

  racers = racers.map((racer) =>
    simulateRacer(racer, deltaMs, connectedByPlayerId.get(racer.playerId) !== false)
  );
  racers = resolveRacerBumps(racers);
  racers = racers.map((racer) => resolveTrackInteractions(racer, deltaMs));

  const weapons = updateWeapons(state, racers, deltaMs);
  racers = weapons.racers;

  let nextFinishOrder = state.nextFinishOrder;
  const elapsedMs = Math.min(state.maxRaceMs, state.elapsedMs + deltaMs);
  racers = racers.map((racer) => {
    const progressUpdate = updateRacerProgress(racer, elapsedMs, nextFinishOrder, state.lapsToWin);
    nextFinishOrder = progressUpdate.nextFinishOrder;
    return progressUpdate.racer;
  });
  racers = assignRanks(racers);

  const humans = racers.filter((racer) => !racer.isBot);
  const allFinished = humans.length > 0 ? humans.every((r) => r.finished) : racers.every((r) => r.finished);
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
    message:
      allFinished || isTimedOut ? buildRaceMessage({ ...state, racers, isTimedOut }, context.language) : state.message
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
    trackId: state.trackId,
    trackName: state.trackName,
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
    pickups: state.pickups.map((p) => ({ id: p.id, x: p.x, y: p.y, active: p.active })),
    projectiles: state.projectiles.map(toPublicProjectile),
    racers: state.racers.map(toPublicRacer)
  };
}

function buildScore(state: DriftRacerRuntimeState): ScoreEntry[] {
  // Bots never score; humans are ranked among themselves.
  const humans = sortRacersForRank(state.racers).filter((racer) => !racer.isBot);
  return humans.map((racer, index) => ({
    playerId: racer.playerId,
    delta: Math.max(1, humans.length - index),
    reason: index === 0 ? "Drift Racer Sieg" : "Drift Racer Platzierung"
  }));
}

function buildTrackState(): {
  trackId: string;
  trackName: string;
  trackLength: number;
  track: DriftRacerState["track"];
  ramps: DriftRacerState["ramps"];
} {
  const track = getTrack();
  return {
    trackId: track.id,
    trackName: track.name,
    trackLength: track.length,
    track: track.points,
    ramps: getRamps()
  };
}

export const serverGame: ServerGame<DriftRacerRuntimeState, DriftRacerInput, DriftRacerState> = {
  manifest: driftRacerManifest,
  handleHostAction(state, action) {
    const hostAction = action as { type?: string; track?: unknown; laps?: unknown; bots?: unknown } | null;
    if (state || hostAction?.type !== "configure-lobby") {
      return {};
    }

    const roomSettings: Record<string, unknown> = {};
    if (typeof hostAction.track === "string" && (hostAction.track === "rotate" || driftRacerTrackIds.includes(hostAction.track))) {
      roomSettings[driftRacerRoomSettingKeys.track] = hostAction.track;
    }
    if (typeof hostAction.laps === "number" && Number.isFinite(hostAction.laps)) {
      roomSettings[driftRacerRoomSettingKeys.laps] = clamp(Math.round(hostAction.laps), 1, 6);
    }
    if (typeof hostAction.bots === "number" && Number.isFinite(hostAction.bots)) {
      roomSettings[driftRacerRoomSettingKeys.bots] = clamp(Math.round(hostAction.bots), 0, 5);
    }
    return { roomSettings };
  },
  createInitialState(context) {
    const settings = readSettings(context);
    if (settings.track !== "rotate") {
      setActiveDriftRacerTrack(settings.track);
    }
    const trackState = buildTrackState();
    return {
      ...createBaseRoundState("round_intro", context.now, {
        durationMs: phaseTimings.roundIntroMs,
        message: context.language === "en" ? "Engines warming up." : "Motoren laufen warm."
      }),
      ...trackState,
      worldWidth: driftRacerTrackConfig.worldWidth,
      worldHeight: driftRacerTrackConfig.worldHeight,
      trackWidth: driftRacerTrackConfig.trackWidth,
      wallHeight: driftRacerTrackConfig.wallHeight,
      lapsToWin: settings.laps,
      maxRaceMs: driftRacerTrackConfig.maxRaceMs,
      elapsedMs: 0,
      tick: 0,
      winnerPlayerId: undefined,
      winnerName: undefined,
      isTimedOut: false,
      pickups: createPickups(),
      projectiles: [],
      racers: assignRanks(createRacers(context, settings.bots)),
      nextFinishOrder: 1,
      nextProjectileId: 1
    };
  },
  startRound(_state, context) {
    const settings = readSettings(context);
    // Fixed pick from the setup screen, or rotate to the next map each race.
    setActiveDriftRacerTrack(settings.track === "rotate" ? undefined : settings.track);
    const trackState = buildTrackState();
    return transitionRoundState(
      {
        ..._state,
        ...trackState,
        lapsToWin: settings.laps,
        elapsedMs: 0,
        tick: 0,
        winnerPlayerId: undefined,
        winnerName: undefined,
        isTimedOut: false,
        racers: assignRanks(createRacers(context, settings.bots)),
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
    if (input.type !== "drive" || state.phase !== "playing") return state;
    const racerIndex = state.racers.findIndex((racer) => racer.playerId === input.playerId);
    if (racerIndex === -1) return state;

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
    return { ...state, racers, updatedAt: input.sentAt ?? context.now };
  },
  tick(state, deltaMs, context) {
    if (state.phase !== "playing") return state;
    return tickRace(state, deltaMs, context);
  },
  isRoundFinished(state) {
    const humans = state.racers.filter((racer) => !racer.isBot);
    const done = humans.length > 0 ? humans.every((r) => r.finished) : state.racers.every((r) => r.finished);
    return state.phase === "locked" || state.isTimedOut || (state.racers.length > 0 && done);
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
