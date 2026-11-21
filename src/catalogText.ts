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
  },
  "es": {
    "displayName": "Drift Racer",
    "description": "Carreras arcade con pantalla dividida en tercera persona, derrapes cerrados y duelos de impulso.",
    "lobbySetup": { "title": "Configuración de Drift Racer", "description": "Elijan el circuito, las vueltas y cuántos rivales de IA habrá.", "fields": {
      "track": { "label": "Circuito", "options": {
        "rotate": { "label": "Rotar circuitos", "description": "Cada carrera usa automáticamente el siguiente circuito." },
        "palm-bay": { "label": "Palm Bay", "description": "Circuito insular compacto con dos rampas." },
        "lagoon-loop": { "label": "Lagoon Loop", "description": "Curvas largas y fluidas con tres rampas." },
        "volcano-ridge": { "label": "Volcano Ridge", "description": "El circuito más largo, con cuatro rampas y cambios cerrados." }
      } },
      "laps": { "label": "Vueltas", "description": "Número de vueltas hasta la meta." },
      "bots": { "label": "Rivales de IA", "description": "Pilotos controlados por el juego que se suman a la carrera." }
    } }, "visual": { "eyebrow": "Carreras" }
  },
  "fr": {
    "displayName": "Drift Racer",
    "description": "Courses arcade avec écran partagé à la troisième personne, dérapages serrés et duels de turbo.",
    "lobbySetup": { "title": "Configuration de Drift Racer", "description": "Choisissez le circuit, le nombre de tours et de rivaux IA.", "fields": {
      "track": { "label": "Circuit", "options": {
        "rotate": { "label": "Rotation des circuits", "description": "Chaque course utilise automatiquement le circuit suivant." },
        "palm-bay": { "label": "Palm Bay", "description": "Circuit insulaire compact avec deux tremplins." },
        "lagoon-loop": { "label": "Lagoon Loop", "description": "De longues courbes fluides et trois tremplins." },
        "volcano-ridge": { "label": "Volcano Ridge", "description": "Le circuit le plus long, avec quatre tremplins et des virages serrés." }
      } },
      "laps": { "label": "Tours", "description": "Nombre de tours avant l’arrivée." },
      "bots": { "label": "Rivaux IA", "description": "Pilotes contrôlés par le jeu ajoutés à la course." }
    } }, "visual": { "eyebrow": "Course" }
  },
  "pt-BR": {
    "displayName": "Drift Racer",
    "description": "Corridas arcade com tela dividida em terceira pessoa, derrapagens fechadas e duelos de impulso.",
    "lobbySetup": { "title": "Configuração do Drift Racer", "description": "Escolham a pista, o número de voltas e de rivais de IA.", "fields": {
      "track": { "label": "Pista", "options": {
        "rotate": { "label": "Alternar pistas", "description": "Cada corrida usa automaticamente a próxima pista." },
        "palm-bay": { "label": "Palm Bay", "description": "Circuito compacto em uma ilha com duas rampas." },
        "lagoon-loop": { "label": "Lagoon Loop", "description": "Curvas longas e fluidas com três rampas." },
        "volcano-ridge": { "label": "Volcano Ridge", "description": "A pista mais longa, com quatro rampas e mudanças fechadas." }
      } },
      "laps": { "label": "Voltas", "description": "Quantas voltas até a chegada." },
      "bots": { "label": "Rivais de IA", "description": "Pilotos controlados pelo jogo que entram na corrida." }
    } }, "visual": { "eyebrow": "Corrida" }
  }
} as const satisfies LocalizedGameTextMap;
