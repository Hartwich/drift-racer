import Phaser from "phaser";
import { driftRacerManifest } from "../manifest.js";
import type { DriftRacerState } from "../protocol.js";
import {
  drawDriftRacerScene,
  type DriftRacerHudInstruction
} from "./DriftRacerRenderer.js";

const hostTheme = {
  bodyFont: '"Nunito Sans", sans-serif'
};

interface HostClientLike {
  subscribe(callback: (state: HostAppStateLike) => void): () => void;
}

interface HostAppStateLike {
  game?: {
    state?: unknown;
  } | null;
  room?: {
    language?: "de" | "en";
  } | null;
}

export class DriftRacerHostScene extends Phaser.Scene {
  private unsubscribe?: () => void;
  private graphics?: Phaser.GameObjects.Graphics;
  private readonly hudTexts = new Map<string, Phaser.GameObjects.Text>();

  constructor() {
    super(driftRacerManifest.hostView);
  }

  create(): void {
    const client = this.registry.get("hostClient") as HostClientLike;

    this.cameras.main.setBackgroundColor("#020617");
    this.graphics = this.add.graphics();

    this.unsubscribe = client.subscribe((state) => {
      const gameState = (state.game?.state ?? null) as DriftRacerState | null;

      if (!this.graphics) {
        return;
      }

      if (!gameState) {
        this.graphics.clear();
        this.syncHud([]);
        return;
      }

      const hud = drawDriftRacerScene(this, this.graphics, gameState, state.room?.language === "en");
      this.syncHud(hud);
    });

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.unsubscribe?.();
      this.unsubscribe = undefined;
      this.graphics?.destroy();
      this.graphics = undefined;
      for (const text of this.hudTexts.values()) {
        text.destroy();
      }
      this.hudTexts.clear();
    });
  }

  private syncHud(instructions: DriftRacerHudInstruction[]): void {
    const activeKeys = new Set(instructions.map((instruction) => instruction.key));

    for (const [key, text] of this.hudTexts) {
      if (!activeKeys.has(key)) {
        text.setVisible(false);
      }
    }

    for (const instruction of instructions) {
      let text = this.hudTexts.get(instruction.key);

      if (!text) {
        text = this.add.text(instruction.x, instruction.y, "", {
          fontFamily: hostTheme.bodyFont,
          fontSize: `${instruction.fontSize}px`,
          color: instruction.color,
          fontStyle: "900",
          align: instruction.align ?? "left"
        });
        text.setShadow(0, 2, "#020617", 6, true, true);
        this.hudTexts.set(instruction.key, text);
      }

      text.setVisible(true);
      text.setText(instruction.text);
      text.setPosition(instruction.x, instruction.y);
      text.setOrigin(instruction.originX ?? 0, instruction.originY ?? 0);
      text.setStyle({
        fontFamily: hostTheme.bodyFont,
        fontSize: `${instruction.fontSize}px`,
        color: instruction.color,
        fontStyle: "900",
        align: instruction.align ?? "left"
      });
    }
  }
}

export const hostGame = {
  id: driftRacerManifest.id,
  displayName: driftRacerManifest.displayName,
  sceneKey: driftRacerManifest.hostView,
  scene: DriftRacerHostScene
} as const;
