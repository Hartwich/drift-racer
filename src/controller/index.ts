import { driftRacerManifest } from "../manifest.js";
import type { DriftRacerState } from "../protocol.js";
import {
  createDriftRacerDriveInput,
  type DriftRacerControllerControls
} from "./driftRacerBindings.js";

type SupportedLanguage = "de" | "en";

interface RacingControlsLayoutModel {
  kind: "racing_controls";
  disabled: boolean;
  accentColor?: string;
  resetKey: string;
  onControlsChange: (controls: DriftRacerControllerControls) => void;
}

interface ControllerGameRenderContext {
  state: {
    preferredLanguage?: SupportedLanguage;
    room?: {
      language?: SupportedLanguage;
    } | null;
    player?: {
      id: string;
      color?: string;
    } | null;
    game?: {
      phase?: string;
      roundNumber?: number;
      state?: unknown;
    } | null;
  };
  onInput(input: unknown): void;
}

export function buildDriftRacerControllerModel(
  context: ControllerGameRenderContext
): RacingControlsLayoutModel {
  const playerId = context.state.player?.id ?? "";
  const gameState = (context.state.game?.state ?? null) as DriftRacerState | null;
  const racer = gameState?.racers.find((entry) => entry.playerId === playerId);
  const disabled = context.state.game?.phase !== "playing" || racer?.finished === true;

  return {
    kind: "racing_controls",
    disabled,
    accentColor: racer?.color ?? context.state.player?.color ?? "#22d3ee",
    resetKey: `${context.state.game?.roundNumber ?? 0}:${context.state.game?.phase ?? "idle"}:${racer?.finished ? "done" : "run"}`,
    onControlsChange: (controls: DriftRacerControllerControls) => {
      if (!playerId) {
        return;
      }

      context.onInput(createDriftRacerDriveInput(playerId, controls));
    }
  };
}

export const controllerGame = {
  id: driftRacerManifest.id,
  layoutKey: "racing_controls",
  buildLayout(context: ControllerGameRenderContext) {
    return buildDriftRacerControllerModel(context);
  }
} as const;
