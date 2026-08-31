import {
  HOST_THEME_REGISTRY_KEY,
  toPhaserColor,
  type GameHostThemeTokens,
  type RegistryLike
} from "@open-party-lab/game-core";

/**
 * The platform theme, as this game consumes it.
 *
 * The platform puts the live token object into the Phaser registry; it is
 * mutated in place when the room switches skin, so everything here reads
 * through `tokens()` at draw time rather than caching values.
 *
 * The fallback keeps the game runnable without the platform — its own dev
 * harness, or a test that instantiates the scene directly.
 */

const fallback: GameHostThemeTokens = {
  color: {
    background: "#020617",
    backgroundDeep: "#010309",
    surface: "#0f172a",
    surfaceMuted: "#0b1320",
    surfaceRaised: "#162033",
    text: "#f8fafc",
    textSoft: "#cbd5e1",
    muted: "#94a3b8",
    line: "#1e293b",
    lineStrong: "#334155",
    accent: "#0ea5e9",
    accentStrong: "#0284c7",
    accentSoft: "#082f49",
    success: "#10b981",
    successStrong: "#059669",
    successSoft: "#08362a",
    warning: "#f59e0b",
    warningSoft: "#2b1f0a",
    danger: "#ef4444",
    dangerSoft: "#3f1414",
    onAccent: "#082f49"
  },
  font: {
    display: '"Space Grotesk", sans-serif',
    body: '"Nunito Sans", sans-serif',
    mono: '"IBM Plex Mono", monospace'
  },
  elevation: {
    hairline: "none",
    card: "none",
    panel: "none",
    dock: "none",
    dockActive: "none",
    modal: "none"
  },
  scrim: {
    surface: "rgba(15, 23, 42, 0.94)",
    surfaceSoft: "rgba(8, 15, 30, 0.72)",
    backdrop: "rgba(2, 6, 23, 0.62)",
    line: "rgba(148, 163, 184, 0.18)"
  }
};

let registry: RegistryLike | undefined;

/** Called once by the scene so later reads can stay parameterless. */
export function bindPlatformTheme(sceneRegistry: RegistryLike | undefined): void {
  registry = sceneRegistry;
}

/** The active tokens. Never cache the result across frames. */
export function tokens(): GameHostThemeTokens {
  return (registry?.get(HOST_THEME_REGISTRY_KEY) as GameHostThemeTokens | undefined) ?? fallback;
}

/** A token as a Phaser colour number. */
export function tokenColor(pick: (theme: GameHostThemeTokens) => string): number {
  return toPhaserColor(pick(tokens()));
}
