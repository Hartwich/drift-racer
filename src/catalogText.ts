import type { LocalizedGameTextMap } from "@open-party-lab/game-core";

export const driftRacerText = {
  "de": {
    "displayName": "Drift Racer",
    "description": "Arcade-Rennen mit Drittperson-Splitscreen, engen Drifts und Boost-Duellen.",
    "lobbySetup": {
      "title": "Drift Racer Setup",
      "description": "Waehlt Strecke, Rundenzahl und die Anzahl der KI-Gegner.",
      "fields": {
        "track": {
          "label": "Strecke",
          "options": {
            "rotate": {
              "label": "Wechselnd",
              "description": "Jedes Rennen faehrt automatisch die naechste Strecke."
            },
            "palm-bay": {
              "label": "Palm Bay",
              "description": "Kompakter Inselkurs mit zwei Sprungschanzen."
            },
            "lagoon-loop": {
              "label": "Lagoon Loop",
              "description": "Lange, flüssige Kurvenkombinationen und drei Schanzen."
            },
            "volcano-ridge": {
              "label": "Volcano Ridge",
              "description": "Laengste Strecke mit vier Schanzen und engen Wechseln."
            }
          }
        },
        "laps": {
          "label": "Runden",
          "description": "Wie viele Runden bis zum Ziel."
        },
        "bots": {
          "label": "KI-Gegner",
          "description": "Zusaetzliche Computer-Fahrer im Feld."
        }
      }
    },
    "visual": {
      "eyebrow": "Rennen"
    }
  },
  "en": {
    "displayName": "Drift Racer",
    "description": "An RC-style 3D arcade racer with cinematic camera flights, weapons and AI rivals.",
    "lobbySetup": {
      "title": "Drift Racer setup",
      "description": "Choose the track, lap count and number of AI rivals.",
      "fields": {
        "track": {
          "label": "Track",
          "options": {
            "rotate": {
              "label": "Rotate tracks",
              "description": "Each race automatically uses the next track."
            },
            "palm-bay": {
              "label": "Palm Bay",
              "description": "A compact island circuit with two jumps."
            },
            "lagoon-loop": {
              "label": "Lagoon Loop",
              "description": "Long, flowing corners and three jumps."
            },
            "volcano-ridge": {
              "label": "Volcano Ridge",
              "description": "The longest circuit, with four jumps and tight changes of direction."
            }
          }
        },
        "laps": {
          "label": "Laps",
          "description": "How many laps to complete before the finish."
        },
        "bots": {
          "label": "AI rivals",
          "description": "Additional computer-controlled racers on the grid."
        }
      }
    },
    "visual": {
      "eyebrow": "Racing"
    }
  }
} as const satisfies LocalizedGameTextMap;
