import Phaser from "phaser";
import { driftRacerManifest } from "../manifest.js";
import type { DriftRacerState } from "../protocol.js";
import { DriftRacerRenderer } from "./DriftRacerRenderer.js";

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

/**
 * Thin Phaser host scene. All visuals are produced by the Three.js
 * {@link DriftRacerRenderer}, which mounts its own WebGL canvas + DOM HUD over
 * the Phaser surface. The scene only wires up lifecycle and forwards state.
 */
export class DriftRacerHostScene extends Phaser.Scene {
  private unsubscribe?: () => void;
  private driftRenderer?: DriftRacerRenderer;

  constructor() {
    super(driftRacerManifest.hostView);
  }

  create(): void {
    const client = this.registry.get("hostClient") as HostClientLike;
    this.cameras.main.setBackgroundColor("#b8cfe0");

    const parent = document.getElementById("app");
    if (!parent) {
      throw new Error("Host app root missing.");
    }

    const driftRenderer = new DriftRacerRenderer();
    driftRenderer.mount(parent);
    this.driftRenderer = driftRenderer;

    this.unsubscribe = client.subscribe((state) => {
      const gameState = (state.game?.state ?? null) as DriftRacerState | null;
      driftRenderer.setState(gameState, state.room?.language === "en");
    });

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.unsubscribe?.();
      this.unsubscribe = undefined;
      this.driftRenderer?.dispose();
      this.driftRenderer = undefined;
    });
  }
}

export const hostGame = {
  id: driftRacerManifest.id,
  displayName: driftRacerManifest.displayName,
  sceneKey: driftRacerManifest.hostView,
  scene: DriftRacerHostScene
} as const;
