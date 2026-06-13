import type { GameManifest } from "@open-party-lab/game-core";

export const driftRacerManifest = {
  id: "drift-racer",
  displayName: "Drift Racer",
  description: "3D-Arcade-Racer im RC-Mini-Car-Stil mit cineastischer Flugkamera, engen Drifts und Boost-Duellen.",
  minPlayers: 1,
  maxPlayers: 4,
  hostView: "DriftRacerHostScene",
  controllerView: "drift-racer",
  controllerLayout: "racing_controls",
  supportsTeams: false,
  estimatedRoundDurationMs: 180_000,
  phaseDurations: {
    roundIntroMs: 1_400,
    countdownMs: 2_000,
    lockedMs: 2_200,
    resultMs: 4_000,
    scoreboardMs: 4_000
  }
} as const satisfies GameManifest;

export const manifest = driftRacerManifest;
