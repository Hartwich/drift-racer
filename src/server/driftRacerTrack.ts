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
  /** Track distance where the take-off ramp begins to rise. */
  startDistance: number;
  /** Length of the rising take-off (lip is at startDistance + length). */
  length: number;
  /** Peak height of the ramp lip, in world units. */
  peak: number;
}

export const driftRacerTrackConfig = {
  worldWidth: 3_200,
  worldHeight: 2_200,
  trackWidth: 300,
  lapsToWin: 3,
  maxRaceMs: 150_000,
  carRadius: 30,
  wallHeight: 28
} as const;

// Hand-authored clockwise circuit. Start/finish sits on the long bottom
// straight; the loop has fast sweepers, a top chicane and two jump straights.
const WAYPOINTS: [number, number][] = [
  [1100, 1805],
  [1500, 1830],
  [2300, 1770],
  [2800, 1470],
  [2950, 1060],
  [2790, 650],
  [2250, 470],
  [1780, 560],
  [1500, 470],
  [980, 560],
  [560, 820],
  [380, 1250],
  [560, 1620],
  [760, 1755]
];

const SAMPLE_STEP = 28;

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

function buildCenterline(): { x: number; y: number }[] {
  const count = WAYPOINTS.length;
  const dense: [number, number][] = [];
  for (let i = 0; i < count; i += 1) {
    const p0 = WAYPOINTS[(i - 1 + count) % count];
    const p1 = WAYPOINTS[i];
    const p2 = WAYPOINTS[(i + 1) % count];
    const p3 = WAYPOINTS[(i + 2) % count];
    for (let s = 0; s < 40; s += 1) {
      dense.push(catmullRom(p0, p1, p2, p3, s / 40));
    }
  }

  const hyp = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const cumulative = [0];
  let total = 0;
  for (let i = 1; i < dense.length; i += 1) {
    total += hyp(dense[i - 1], dense[i]);
    cumulative.push(total);
  }
  total += hyp(dense[dense.length - 1], dense[0]);

  const sampleCount = Math.round(total / SAMPLE_STEP);
  const step = total / sampleCount;
  const points: { x: number; y: number }[] = [];
  let denseIndex = 0;
  for (let k = 0; k < sampleCount; k += 1) {
    const target = k * step;
    while (denseIndex < cumulative.length - 1 && cumulative[denseIndex + 1] < target) {
      denseIndex += 1;
    }
    const segLength = (cumulative[denseIndex + 1] ?? total) - cumulative[denseIndex];
    const f = segLength > 0 ? (target - cumulative[denseIndex]) / segLength : 0;
    const a = dense[denseIndex];
    const b = dense[(denseIndex + 1) % dense.length];
    points.push({ x: a[0] + (b[0] - a[0]) * f, y: a[1] + (b[1] - a[1]) * f });
  }
  return points;
}

function createTrack(): {
  points: DriftRacerTrackPoint[];
  segments: TrackSegment[];
  length: number;
} {
  const rawPoints = buildCenterline();
  const lengths = rawPoints.map((point, index) => {
    const next = rawPoints[(index + 1) % rawPoints.length];
    return Math.hypot(next.x - point.x, next.y - point.y);
  });
  let accumulatedDistance = 0;
  const points = rawPoints.map((point, index) => {
    const trackPoint = {
      ...point,
      distance: accumulatedDistance
    };
    accumulatedDistance += lengths[index];
    return trackPoint;
  });
  const length = accumulatedDistance;
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

  return { points, segments, length };
}

export const driftRacerTrack = createTrack();

// Jump ramps, positioned by fraction of the lap so they land on (mostly)
// straight sections. The lip is at startDistance + length.
export const driftRacerRamps: DriftRacerRamp[] = [
  { startDistance: 0.115 * driftRacerTrack.length - 240, length: 240, peak: 95 },
  { startDistance: 0.66 * driftRacerTrack.length - 200, length: 200, peak: 60 }
].map((ramp) => ({
  ...ramp,
  startDistance: (ramp.startDistance + driftRacerTrack.length) % driftRacerTrack.length
}));

export function wrapTrackDistance(distance: number): number {
  const wrapped = distance % driftRacerTrack.length;
  return wrapped >= 0 ? wrapped : wrapped + driftRacerTrack.length;
}

/** Ramp surface height (and slope) at a track distance. */
export function sampleRampHeight(distance: number): { height: number; slope: number } {
  const d = wrapTrackDistance(distance);
  for (const ramp of driftRacerRamps) {
    const end = ramp.startDistance + ramp.length;
    if (d >= ramp.startDistance && d <= end) {
      return { height: (ramp.peak * (d - ramp.startDistance)) / ramp.length, slope: ramp.peak / ramp.length };
    }
  }
  return { height: 0, slope: 0 };
}

export function sampleDriftRacerTrack(distance: number): DriftRacerTrackSample {
  const wrappedDistance = wrapTrackDistance(distance);
  const segment =
    driftRacerTrack.segments.find(
      (entry) => wrappedDistance >= entry.startDistance && wrappedDistance <= entry.startDistance + entry.length
    ) ?? driftRacerTrack.segments[driftRacerTrack.segments.length - 1];
  const start = driftRacerTrack.points[segment.startIndex];
  const t = Math.max(0, Math.min(1, (wrappedDistance - segment.startDistance) / segment.length));

  return {
    x: start.x + segment.tangentX * segment.length * t,
    y: start.y + segment.tangentY * segment.length * t,
    distance: wrappedDistance,
    angleRad: Math.atan2(segment.tangentY, segment.tangentX),
    normalX: segment.normalX,
    normalY: segment.normalY
  };
}

export function projectPointToDriftRacerTrack(x: number, y: number): DriftRacerTrackProjection {
  let bestProjection: DriftRacerTrackProjection | null = null;
  let bestDistanceSq = Number.POSITIVE_INFINITY;

  for (const segment of driftRacerTrack.segments) {
    const start = driftRacerTrack.points[segment.startIndex];
    const dx = x - start.x;
    const dy = y - start.y;
    const t = Math.max(0, Math.min(1, (dx * segment.tangentX + dy * segment.tangentY) / segment.length));
    const projectedX = start.x + segment.tangentX * segment.length * t;
    const projectedY = start.y + segment.tangentY * segment.length * t;
    const offsetX = x - projectedX;
    const offsetY = y - projectedY;
    const distanceSq = offsetX * offsetX + offsetY * offsetY;

    if (distanceSq >= bestDistanceSq) {
      continue;
    }

    const signedLateralDistance = offsetX * segment.normalX + offsetY * segment.normalY;
    bestDistanceSq = distanceSq;
    bestProjection = {
      x: projectedX,
      y: projectedY,
      distance: wrapTrackDistance(segment.startDistance + segment.length * t),
      angleRad: Math.atan2(segment.tangentY, segment.tangentX),
      normalX: segment.normalX,
      normalY: segment.normalY,
      signedLateralDistance,
      lateralDistance: Math.abs(signedLateralDistance)
    };
  }

  if (!bestProjection) {
    const fallback = sampleDriftRacerTrack(0);
    return { ...fallback, signedLateralDistance: 0, lateralDistance: 0 };
  }

  return bestProjection;
}

export interface DriftRacerPickupAnchor {
  id: string;
  x: number;
  y: number;
}

// Item-box rows spread around the lap (3 boxes across the track each).
export const driftRacerPickups: DriftRacerPickupAnchor[] = (() => {
  const rows = [0.27, 0.52, 0.82];
  const lanes = [-0.26, 0, 0.26];
  const out: DriftRacerPickupAnchor[] = [];
  rows.forEach((frac, rowIndex) => {
    const sample = sampleDriftRacerTrack(frac * driftRacerTrack.length);
    lanes.forEach((lane, laneIndex) => {
      const offset = lane * driftRacerTrackConfig.trackWidth;
      out.push({
        id: `pickup-${rowIndex}-${laneIndex}`,
        x: sample.x + sample.normalX * offset,
        y: sample.y + sample.normalY * offset
      });
    });
  });
  return out;
})();
