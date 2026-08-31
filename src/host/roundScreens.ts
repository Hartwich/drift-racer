import Phaser from "phaser";
import { driftRacerManifest } from "../manifest.js";

/**
 * Round intro and result screens for Drift Racer.
 *
 * The platform ships no scoreboard or intro scene: everything a player looks at
 * once a game has started belongs to the game. This module is this repo's own
 * copy, so the look can diverge from the other games freely.
 *
 * The screens are drawn into a dedicated container above the playfield rather
 * than into the scene itself. That matters for two reasons: scenes that keep
 * persistent renderer objects between frames must not have their display list
 * cleared underneath them, and the overlay has to disappear on its own the
 * moment the round starts playing.
 */

const INTRO_PHASES = new Set(["round_intro", "countdown"]);
const RESULT_PHASES = new Set(["result", "scoreboard", "finished"]);
const OVERLAY_DEPTH = 10_000;

/** Warm paper palette, matching the platform shell. */
const theme = {
  background: "#f7f1e7",
  surface: "#fffbf4",
  surfaceMuted: "#f3ece0",
  ink: "#24313a",
  inkSoft: "#3d4b55",
  muted: "#697178",
  line: "#ded5c7",
  accent: "#a2683c",
  titleFont: 'Georgia, "Iowan Old Style", "Times New Roman", serif',
  bodyFont: 'Inter, ui-sans-serif, -apple-system, "Segoe UI", sans-serif',
  monoFont: '"IBM Plex Mono", ui-monospace, Menlo, monospace'
};

const hex = (color: string): number => Number.parseInt(color.slice(1), 16);

interface ScoreEntryLike {
  playerId: string;
  delta: number;
  total: number;
}

interface RoundScreenState {
  phase: string | null;
  message: string | null;
  language: "de" | "en";
  players: Array<{ id: string; name: string }>;
  entries: ScoreEntryLike[];
}

const copy = {
  de: {
    getReady: "Gleich geht es los",
    roundOver: "Runde vorbei",
    standings: "PUNKTESTAND",
    noPoints: "Noch keine Punkte.",
    waiting: "Bereit melden fuer die naechste Runde."
  },
  en: {
    getReady: "Starting shortly",
    roundOver: "Round over",
    standings: "STANDINGS",
    noPoints: "No points yet.",
    waiting: "Ready up for the next round."
  }
};

/** Narrows the loosely typed host state this scene receives. */
function readState(input: unknown): RoundScreenState {
  const state = (input ?? {}) as {
    game?: { phase?: unknown; message?: unknown } | null;
    room?: { language?: unknown; players?: unknown; currentRound?: { phase?: unknown } | null } | null;
    scoreboard?: { entries?: unknown } | null;
  };

  const phase =
    typeof state.game?.phase === "string"
      ? state.game.phase
      : typeof state.room?.currentRound?.phase === "string"
        ? state.room.currentRound.phase
        : null;

  const players = Array.isArray(state.room?.players)
    ? (state.room?.players as Array<{ id?: unknown; name?: unknown }>)
        .filter((player) => typeof player?.id === "string")
        .map((player) => ({
          id: String(player.id),
          name: typeof player.name === "string" ? player.name : String(player.id)
        }))
    : [];

  const entries = Array.isArray(state.scoreboard?.entries)
    ? (state.scoreboard?.entries as Array<Record<string, unknown>>)
        .filter((entry) => typeof entry?.playerId === "string")
        .map((entry) => ({
          playerId: String(entry.playerId),
          delta: Number(entry.delta ?? 0),
          total: Number(entry.total ?? 0)
        }))
    : [];

  return {
    phase,
    message: typeof state.game?.message === "string" ? state.game.message : null,
    language: state.room?.language === "en" ? "en" : "de",
    players,
    entries
  };
}

/**
 * The overlay container per scene.
 *
 * A WeakMap rather than scene data, so nothing has to be registered or torn
 * down when the scene shuts down.
 */
const overlays = new WeakMap<Phaser.Scene, Phaser.GameObjects.Container>();

/** Removes the overlay if one is up. Safe to call when there is none. */
function clearOverlay(scene: Phaser.Scene): void {
  const existing = overlays.get(scene);

  if (existing) {
    overlays.delete(scene);

    // `scene` is null once Phaser has destroyed the object with the scene.
    if (existing.scene) {
      existing.destroy(true);
    }
  }
}

/** Starts a fresh overlay that fully covers the playfield. */
function openOverlay(scene: Phaser.Scene): Phaser.GameObjects.Container {
  clearOverlay(scene);

  const layer = scene.add.container(0, 0).setDepth(OVERLAY_DEPTH);
  const width = scene.scale.width;
  const height = scene.scale.height;

  layer.add(
    scene.add.rectangle(0, 0, width, height, hex(theme.background), 1).setOrigin(0)
  );

  const decoration = scene.add.graphics();
  decoration.fillStyle(hex(theme.accent), 0.08);
  decoration.fillCircle(width * 0.16, height * 0.18, Math.max(width * 0.2, 180));
  decoration.fillCircle(width * 0.84, height * 0.84, Math.max(width * 0.18, 160));
  layer.add(decoration);

  overlays.set(scene, layer);
  return layer;
}

function textResolution(): number {
  const ratio = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
  return Math.min(Math.max(ratio, 1), 3);
}

function addText(
  scene: Phaser.Scene,
  layer: Phaser.GameObjects.Container,
  x: number,
  y: number,
  content: string,
  style: Phaser.Types.GameObjects.Text.TextStyle
): Phaser.GameObjects.Text {
  const text = scene.add.text(x, y, content, { resolution: textResolution(), ...style });
  layer.add(text);
  return text;
}

function renderIntro(scene: Phaser.Scene, state: RoundScreenState): void {
  const layer = openOverlay(scene);
  const words = copy[state.language];

  addText(
    scene,
    layer,
    scene.scale.width / 2,
    scene.scale.height / 2 - 60,
    driftRacerManifest.displayName,
    {
      fontFamily: theme.titleFont,
      fontSize: "56px",
      color: theme.ink,
      align: "center",
      wordWrap: { width: scene.scale.width - 160 }
    }
  ).setOrigin(0.5);

  addText(
    scene,
    layer,
    scene.scale.width / 2,
    scene.scale.height / 2 + 24,
    state.message ?? words.getReady,
    {
      fontFamily: theme.bodyFont,
      fontSize: "24px",
      color: theme.muted,
      align: "center",
      wordWrap: { width: scene.scale.width - 220 }
    }
  ).setOrigin(0.5);
}

function renderResult(scene: Phaser.Scene, state: RoundScreenState): void {
  const layer = openOverlay(scene);
  const words = copy[state.language];
  const nameById = new Map(state.players.map((player) => [player.id, player.name]));
  const panelWidth = Math.min(760, scene.scale.width - 120);
  const panelX = (scene.scale.width - panelWidth) / 2;

  addText(scene, layer, panelX, 64, words.roundOver, {
    fontFamily: theme.titleFont,
    fontSize: "44px",
    color: theme.ink
  });
  addText(scene, layer, panelX, 122, state.message ?? driftRacerManifest.displayName, {
    fontFamily: theme.bodyFont,
    fontSize: "20px",
    color: theme.muted,
    wordWrap: { width: panelWidth }
  });

  const listTop = 190;
  const rowHeight = 52;
  const visible = state.entries.slice(0, 8);

  addText(scene, layer, panelX, listTop - 28, words.standings, {
    fontFamily: theme.monoFont,
    fontSize: "13px",
    color: theme.muted
  });

  if (visible.length === 0) {
    addText(scene, layer, panelX, listTop, words.noPoints, {
      fontFamily: theme.bodyFont,
      fontSize: "20px",
      color: theme.muted
    });
    return;
  }

  visible.forEach((entry, index) => {
    const rowY = listTop + index * rowHeight;
    const leader = index === 0;

    layer.add(
      scene.add
        .rectangle(
          panelX,
          rowY,
          panelWidth,
          rowHeight - 8,
          hex(leader ? theme.surface : theme.surfaceMuted),
          1
        )
        .setOrigin(0)
        .setStrokeStyle(leader ? 2 : 1, hex(leader ? theme.accent : theme.line), 1)
    );

    addText(scene, layer, panelX + 18, rowY + 10, `${index + 1}`, {
      fontFamily: theme.titleFont,
      fontSize: "22px",
      color: leader ? theme.accent : theme.muted
    });
    addText(scene, layer, panelX + 58, rowY + 11, nameById.get(entry.playerId) ?? entry.playerId, {
      fontFamily: theme.bodyFont,
      fontSize: "20px",
      color: theme.ink
    });
    addText(
      scene,
      layer,
      panelX + panelWidth - 150,
      rowY + 13,
      `${entry.delta >= 0 ? "+" : ""}${entry.delta}`,
      {
        fontFamily: theme.monoFont,
        fontSize: "16px",
        color: entry.delta > 0 ? theme.accent : theme.muted
      }
    );
    addText(scene, layer, panelX + panelWidth - 70, rowY + 10, `${entry.total}`, {
      fontFamily: theme.titleFont,
      fontSize: "22px",
      color: theme.inkSoft
    });
  });

  addText(scene, layer, panelX, listTop + visible.length * rowHeight + 18, words.waiting, {
    fontFamily: theme.bodyFont,
    fontSize: "16px",
    color: theme.muted
  });
}

/**
 * Draws the intro or result overlay for the current phase.
 *
 * Returns true while the overlay owns the screen, so the caller can skip its
 * own rendering. As soon as the phase moves on the overlay is removed and false
 * is returned, handing the screen back to the game untouched.
 */
export function renderRoundScreens(scene: Phaser.Scene, input: unknown): boolean {
  const state = readState(input);

  if (state.phase && INTRO_PHASES.has(state.phase)) {
    renderIntro(scene, state);
    return true;
  }

  if (state.phase && RESULT_PHASES.has(state.phase)) {
    renderResult(scene, state);
    return true;
  }

  clearOverlay(scene);
  return false;
}
