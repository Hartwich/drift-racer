import type { GameManifest } from "@open-party-lab/game-core";

/** Room-setting keys written by the lobby setup screen. */
export const driftRacerRoomSettingKeys = {
  track: "driftRacer.track",
  laps: "driftRacer.laps",
  bots: "driftRacer.bots"
} as const;

export const driftRacerManifest = {
  id: "drift-racer",
  displayName: "Drift Racer",
  description: "3D-Arcade-Racer im RC-Mini-Car-Stil mit cineastischer Flugkamera, Waffen und KI-Gegnern.",
  minPlayers: 1,
  maxPlayers: 4,
  hostView: "DriftRacerHostScene",
  controllerView: "drift-racer",
  controllerLayout: "racing_controls",
  supportsTeams: false,
  estimatedRoundDurationMs: 180_000,
  lobbySetup: {
    title: "Drift Racer Setup",
    description: "Waehlt Strecke, Rundenzahl und die Anzahl der KI-Gegner.",
    fields: [
      {
        kind: "select",
        id: "track",
        settingKey: driftRacerRoomSettingKeys.track,
        actionKey: "track",
        label: "Strecke",
        defaultValue: "rotate",
        options: [
          {
            id: "rotate",
            label: "Wechselnd",
            description: "Jedes Rennen faehrt automatisch die naechste Strecke."
          },
          {
            id: "palm-bay",
            label: "Palm Bay",
            description: "Kompakter Inselkurs mit zwei Sprungschanzen."
          },
          {
            id: "lagoon-loop",
            label: "Lagoon Loop",
            description: "Lange, flüssige Kurvenkombinationen und drei Schanzen."
          },
          {
            id: "volcano-ridge",
            label: "Volcano Ridge",
            description: "Laengste Strecke mit vier Schanzen und engen Wechseln."
          }
        ]
      },
      {
        kind: "number",
        id: "laps",
        settingKey: driftRacerRoomSettingKeys.laps,
        actionKey: "laps",
        label: "Runden",
        description: "Wie viele Runden bis zum Ziel.",
        min: 1,
        max: 6,
        step: 1,
        defaultValue: 3
      },
      {
        kind: "number",
        id: "bots",
        settingKey: driftRacerRoomSettingKeys.bots,
        actionKey: "bots",
        label: "KI-Gegner",
        description: "Zusaetzliche Computer-Fahrer im Feld.",
        min: 0,
        max: 5,
        step: 1,
        defaultValue: 3
      }
    ]
  },
  phaseDurations: {
    roundIntroMs: 1_400,
    countdownMs: 2_000,
    lockedMs: 2_200,
    resultMs: 4_000,
    scoreboardMs: 4_000
  },

  ownsScreens: ["round_intro", "result"],
  visual: { accent: "#a2683c", eyebrow: "Racing" },
  audio: { track: { profile: "chase", bpm: 138, rootMidi: 52, masterGain: 0.15 } },
  controllerChrome: { wide: true },
} as const satisfies GameManifest;

export const manifest = driftRacerManifest;
