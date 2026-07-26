import type { DriftRacerTrackPoint } from "../protocol.js";

export interface DriftRacerTrackSample {
  x: number;
  y: number;
  distance: number;
  angleRad: number;
  normalX: number;
  normalY: number;
}

export interface DriftRacerTrackProjection extends DriftRacerTrackSample {
  signedLateralDistance: number;
  lateralDistance: number;
}

interface TrackSegment {
  startIndex: number;
  endIndex: number;
  startDistance: number;
  length: number;
  tangentX: number;
  tangentY: number;
  normalX: number;
  normalY: number;
}

export interface DriftRacerRamp {
  startDistance: number;
  length: number;
  peak: number;
}

export interface DriftRacerPickupAnchor {
  id: string;
  x: number;
  y: number;
}

/** Shared config: identical across tracks so world/scale stay stable. */
export const driftRacerTrackConfig = {
  worldWidth: 3_600,
  worldHeight: 2_500,
  trackWidth: 300,
  lapsToWin: 3,
  maxRaceMs: 210_000,
  carRadius: 30,
  wallHeight: 28
} as const;

const SAMPLE_STEP = 28;

interface RampSpec {
  /** Lap fraction where the ramp lip sits. */
  at: number;
  length: number;
  peak: number;
}

interface TrackSpec {
  id: string;
  name: string;
  /** Either hand-authored waypoints or a star-shaped radial curve. */
  waypoints?: [number, number][];
  radial?: {
    rx: number;
    ry: number;
    wave: { amp: number; freq: number; phase: number }[];
  };
  ramps: RampSpec[];
  pickupRows: number[];
}

const TRACK_SPECS: TrackSpec[] = [
  {
    id: "palm-bay",
    name: "Palm Bay",
    waypoints: [
      [1300, 2055],
      [1700, 2080],
      [2500, 2020],
      [3000, 1720],
      [3150, 1310],
      [2990, 900],
      [2450, 720],
      [1980, 810],
      [1700, 720],
      [1180, 810],
      [760, 1070],
      [580, 1500],
      [760, 1870],
      [960, 2005]
    ],
    ramps: [
      { at: 0.115, length: 240, peak: 95 },
      { at: 0.66, length: 200, peak: 60 }
    ],
    pickupRows: [0.27, 0.52, 0.82]
  },
  {
    id: "lagoon-loop",
    name: "Lagoon Loop",
    radial: {
      rx: 1330,
      ry: 950,
      wave: [
        { amp: 0.14, freq: 3, phase: 0.4 },
        { amp: 0.08, freq: 5, phase: 1.1 },
        { amp: 0.04, freq: 7, phase: 2.2 }
      ]
    },
    ramps: [
      { at: 0.09, length: 250, peak: 100 },
      { at: 0.42, length: 220, peak: 75 },
      { at: 0.74, length: 220, peak: 85 }
    ],
    pickupRows: [0.18, 0.38, 0.58, 0.86]
  },
  {
    id: "volcano-ridge",
    name: "Volcano Ridge",
    radial: {
      rx: 1255,
      ry: 955,
      wave: [
        { amp: 0.17, freq: 2, phase: 0.6 },
        { amp: 0.1, freq: 5, phase: 2.0 },
        { amp: 0.06, freq: 8, phase: 0.2 },
        { amp: 0.03, freq: 11, phase: 1.4 }
      ]
    },
    ramps: [
      { at: 0.13, length: 260, peak: 110 },
      { at: 0.37, length: 210, peak: 70 },
      { at: 0.63, length: 240, peak: 95 },
      { at: 0.88, length: 200, peak: 65 }
    ],
    pickupRows: [0.12, 0.3, 0.5, 0.7, 0.9]
  }
];

export interface DriftRacerTrackRuntime {
  id: string;
  name: string;
  points: DriftRacerTrackPoint[];
  segments: TrackSegment[];
  length: number;
  ramps: DriftRacerRamp[];
  pickups: DriftRacerPickupAnchor[];
}

function catmullRom(
  p0: [number, number],
  p1: [number, number],
  p2: [number, number],
  p3: [number, number],
  t: number
): [number, number] {
  const t2 = t * t;
  const t3 = t2 * t;
  return [
    0.5 *
      (2 * p1[0] +
        (-p0[0] + p2[0]) * t +
        (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
        (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
    0.5 *
      (2 * p1[1] +
        (-p0[1] + p2[1]) * t +
        (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
        (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)
  ];
}

function densePoints(spec: TrackSpec): [number, number][] {
  const cx = driftRacerTrackConfig.worldWidth / 2;
  const cy = driftRacerTrackConfig.worldHeight / 2;

  if (spec.radial) {
    // Star-shaped radial curve: r(theta) > 0 guarantees no self-intersection.
    const out: [number, number][] = [];
    const steps = 720;
    for (let i = 0; i < steps; i += 1) {
      const a = (i / steps) * Math.PI * 2;
      let r = 1;
      for (const w of spec.radial.wave) r += w.amp * Math.sin(w.freq * a + w.phase);
      out.push([cx + spec.radial.rx * r * Math.cos(a), cy + spec.radial.ry * r * Math.sin(a)]);
    }
    return out;
  }

  const wp = spec.waypoints ?? [];
  const count = wp.length;
  const out: [number, number][] = [];
  for (let i = 0; i < count; i += 1) {
    const p0 = wp[(i - 1 + count) % count];
    const p1 = wp[i];
    const p2 = wp[(i + 1) % count];
    const p3 = wp[(i + 2) % count];
    for (let s = 0; s < 40; s += 1) out.push(catmullRom(p0, p1, p2, p3, s / 40));
  }
  return out;
}

function buildTrack(spec: TrackSpec): DriftRacerTrackRuntime {
  const dense = densePoints(spec);
  const hyp = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const cumulative = [0];
  let total = 0;
  for (let i = 1; i < dense.length; i += 1) {
    total += hyp(dense[i - 1], dense[i]);
    cumulative.push(total);
  }
  total += hyp(dense[dense.length - 1], dense[0]);

  const sampleCount = Math.max(64, Math.round(total / SAMPLE_STEP));
  const step = total / sampleCount;
  const raw: { x: number; y: number }[] = [];
  let di = 0;
  for (let k = 0; k < sampleCount; k += 1) {
    const target = k * step;
    while (di < cumulative.length - 1 && cumulative[di + 1] < target) di += 1;
    const segLength = (cumulative[di + 1] ?? total) - cumulative[di];
    const f = segLength > 0 ? (target - cumulative[di]) / segLength : 0;
    const a = dense[di];
    const b = dense[(di + 1) % dense.length];
    raw.push({ x: a[0] + (b[0] - a[0]) * f, y: a[1] + (b[1] - a[1]) * f });
  }

  const lengths = raw.map((point, index) => {
    const next = raw[(index + 1) % raw.length];
    return Math.hypot(next.x - point.x, next.y - point.y);
  });
  let acc = 0;
  const points = raw.map((point, index) => {
    const tp = { ...point, distance: acc };
    acc += lengths[index];
    return tp;
  });
  const length = acc;
  const segments = points.map((point, index) => {
    const nextIndex = (index + 1) % points.length;
    const next = points[nextIndex];
    const segmentLength = lengths[index] || 1;
    const tangentX = (next.x - point.x) / segmentLength;
    const tangentY = (next.y - point.y) / segmentLength;
    return {
      startIndex: index,
      endIndex: nextIndex,
      startDistance: point.distance,
      length: segmentLength,
      tangentX,
      tangentY,
      normalX: -tangentY,
      normalY: tangentX
    };
  });

  const ramps: DriftRacerRamp[] = spec.ramps.map((r) => ({
    startDistance: ((r.at * length - r.length) % length + length) % length,
    length: r.length,
    peak: r.peak
  }));

  const runtime: DriftRacerTrackRuntime = {
    id: spec.id,
    name: spec.name,
    points,
    segments,
    length,
    ramps,
    pickups: []
  };

  const lanes = [-0.26, 0, 0.26];
  const pickups: DriftRacerPickupAnchor[] = [];
  spec.pickupRows.forEach((frac, rowIndex) => {
    const sample = sampleTrackOn(runtime, frac * length);
    lanes.forEach((lane, laneIndex) => {
      const offset = lane * driftRacerTrackConfig.trackWidth;
      pickups.push({
        id: `pickup-${rowIndex}-${laneIndex}`,
        x: sample.x + sample.normalX * offset,
        y: sample.y + sample.normalY * offset
      });
    });
  });
  runtime.pickups = pickups;
  return runtime;
}

function wrapOn(track: DriftRacerTrackRuntime, distance: number): number {
  const wrapped = distance % track.length;
  return wrapped >= 0 ? wrapped : wrapped + track.length;
}

function sampleTrackOn(track: DriftRacerTrackRuntime, distance: number): DriftRacerTrackSample {
  const d = wrapOn(track, distance);
  const segment =
    track.segments.find((e) => d >= e.startDistance && d <= e.startDistance + e.length) ??
    track.segments[track.segments.length - 1];
  const start = track.points[segment.startIndex];
  const t = Math.max(0, Math.min(1, (d - segment.startDistance) / segment.length));
  return {
    x: start.x + segment.tangentX * segment.length * t,
    y: start.y + segment.tangentY * segment.length * t,
    distance: d,
    angleRad: Math.atan2(segment.tangentY, segment.tangentX),
    normalX: segment.normalX,
    normalY: segment.normalY
  };
}

const TRACKS: DriftRacerTrackRuntime[] = TRACK_SPECS.map(buildTrack);
let activeIndex = 0;

export const driftRacerTrackIds = TRACKS.map((t) => t.id);

/** Pick a track by id, or rotate to the next one when omitted. */
export function setActiveDriftRacerTrack(id?: string): DriftRacerTrackRuntime {
  if (id) {
    const index = TRACKS.findIndex((t) => t.id === id);
    if (index >= 0) activeIndex = index;
  } else {
    activeIndex = (activeIndex + 1) % TRACKS.length;
  }
  return TRACKS[activeIndex];
}

export function getTrack(): DriftRacerTrackRuntime {
  return TRACKS[activeIndex];
}

export function getRamps(): DriftRacerRamp[] {
  return TRACKS[activeIndex].ramps;
}

export function getPickups(): DriftRacerPickupAnchor[] {
  return TRACKS[activeIndex].pickups;
}

export function wrapTrackDistance(distance: number): number {
  return wrapOn(getTrack(), distance);
}

export function sampleRampHeight(distance: number): { height: number; slope: number } {
  const track = getTrack();
  const d = wrapOn(track, distance);
  for (const ramp of track.ramps) {
    const end = ramp.startDistance + ramp.length;
    if (d >= ramp.startDistance && d <= end) {
      return { height: (ramp.peak * (d - ramp.startDistance)) / ramp.length, slope: ramp.peak / ramp.length };
    }
  }
  return { height: 0, slope: 0 };
}

export function sampleDriftRacerTrack(distance: number): DriftRacerTrackSample {
  return sampleTrackOn(getTrack(), distance);
}

export function projectPointToDriftRacerTrack(x: number, y: number): DriftRacerTrackProjection {
  const track = getTrack();
  let best: DriftRacerTrackProjection | null = null;
  let bestDistanceSq = Number.POSITIVE_INFINITY;

  for (const segment of track.segments) {
    const start = track.points[segment.startIndex];
    const dx = x - start.x;
    const dy = y - start.y;
    const t = Math.max(0, Math.min(1, (dx * segment.tangentX + dy * segment.tangentY) / segment.length));
    const projectedX = start.x + segment.tangentX * segment.length * t;
    const projectedY = start.y + segment.tangentY * segment.length * t;
    const offsetX = x - projectedX;
    const offsetY = y - projectedY;
    const distanceSq = offsetX * offsetX + offsetY * offsetY;
    if (distanceSq >= bestDistanceSq) continue;
    const signedLateralDistance = offsetX * segment.normalX + offsetY * segment.normalY;
    bestDistanceSq = distanceSq;
    best = {
      x: projectedX,
      y: projectedY,
      distance: wrapOn(track, segment.startDistance + segment.length * t),
      angleRad: Math.atan2(segment.tangentY, segment.tangentX),
      normalX: segment.normalX,
      normalY: segment.normalY,
      signedLateralDistance,
      lateralDistance: Math.abs(signedLateralDistance)
    };
  }

  if (!best) {
    const fallback = sampleDriftRacerTrack(0);
    return { ...fallback, signedLateralDistance: 0, lateralDistance: 0 };
  }
  return best;
}
