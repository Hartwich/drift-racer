import * as THREE from "three";
import type { DriftRacerRacerState, DriftRacerState } from "../protocol.js";

/**
 * Full 3D renderer for Drift Racer.
 *
 * The server simulates an arcade racer in world space (x / y / angle) plus a
 * vertical axis (z) for jumps. This module renders it as a fully 3D RC scene: a
 * tabletop play-mat, a 3D road ribbon with curbs and barriers (Banden) built
 * from the track centreline, jump ramps (Sprungschanzen), colourful mini RC
 * cars and a cinematic flying camera with several switchable angles.
 */

// ---------------------------------------------------------------------------
// Tuning constants
// ---------------------------------------------------------------------------

/** World pixels -> Three.js scene units. */
const WORLD_SCALE = 0.02;
const POS_LERP_RATE = 14;
const ANGLE_LERP_RATE = 12;
const HEIGHT_LERP_RATE = 20;
const SKID_POOL = 240;
const SKID_LIFE_MS = 2600;
const SKID_MIN_STEP = 0.14;

const CAMERA_MODES = ["dynamic", "cinematic", "chase", "overview", "topdown"] as const;
type CameraMode = (typeof CAMERA_MODES)[number];

const CAMERA_LABELS: Record<CameraMode, { de: string; en: string }> = {
  dynamic: { de: "Dynamisch (alle)", en: "Dynamic (all)" },
  cinematic: { de: "Cinematic", en: "Cinematic" },
  chase: { de: "Verfolgung", en: "Chase" },
  overview: { de: "Übersicht", en: "Overview" },
  topdown: { de: "Vogel", en: "Top-down" }
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseColor(color: string | undefined, fallback = "#38bdf8"): THREE.Color {
  try {
    return new THREE.Color(color ?? fallback);
  } catch {
    return new THREE.Color(fallback);
  }
}

function shortestAngleDelta(from: number, to: number): number {
  let delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function disposeObject(object: THREE.Object3D): void {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(material)) {
      material.forEach((entry) => entry.dispose());
    } else if (material) {
      material.dispose();
    }
  });
}

interface CarView {
  group: THREE.Group;
  body: THREE.Group;
  frontPivots: THREE.Group[];
  wheels: THREE.Mesh[];
  boostFlame: THREE.Mesh;
  color: string;
  x: number;
  z: number;
  height: number;
  angle: number;
  targetX: number;
  targetZ: number;
  targetHeight: number;
  targetAngle: number;
  speed: number;
  steer: number;
  vz: number;
  airborne: boolean;
  drifting: boolean;
  boost: boolean;
  finished: boolean;
  wheelSpin: number;
  lastSkid: THREE.Vector2;
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

export class DriftRacerRenderer {
  private root?: HTMLDivElement;
  private hud?: HTMLDivElement;
  private renderer?: THREE.WebGLRenderer;
  private scene?: THREE.Scene;
  private camera?: THREE.PerspectiveCamera;

  private trackGroup?: THREE.Group;
  private carGroup?: THREE.Group;
  private skidGroup?: THREE.Group;
  private skidPool: { mesh: THREE.Mesh; born: number }[] = [];
  private skidCursor = 0;

  private readonly cars = new Map<string, CarView>();

  private state: DriftRacerState | null = null;
  private en = false;
  private trackBuilt = false;
  private offsetX = 0;
  private offsetZ = 0;

  // Cached scene-space track geometry for sampling (ramps, etc.).
  private trackCentre: THREE.Vector2[] = [];
  private trackNormals: THREE.Vector2[] = [];
  private trackDistances: number[] = [];
  private trackLen = 1;
  private halfWidthScene = 3;

  private cameraMode: CameraMode = "dynamic";
  private readonly camPos = new THREE.Vector3(0, 30, 30);
  private readonly camLook = new THREE.Vector3(0, 0, 0);
  private cameraInitialised = false;

  private animationId: number | null = null;
  private lastFrame = 0;
  private lastWidth = 0;
  private lastHeight = 0;
  private keyHandler?: (event: KeyboardEvent) => void;

  // ---- lifecycle -------------------------------------------------------

  mount(parent: HTMLElement): void {
    parent.style.position = parent.style.position || "relative";

    const root = document.createElement("div");
    Object.assign(root.style, {
      position: "absolute",
      inset: "0",
      overflow: "hidden",
      background: "#b8cfe0",
      pointerEvents: "none",
      zIndex: "1"
    } satisfies Partial<CSSStyleDeclaration>);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";
    root.appendChild(renderer.domElement);

    const hud = document.createElement("div");
    Object.assign(hud.style, {
      position: "absolute",
      inset: "0",
      pointerEvents: "none",
      fontFamily: '"Nunito Sans", Inter, system-ui, sans-serif',
      color: "#f8fafc"
    } satisfies Partial<CSSStyleDeclaration>);
    root.appendChild(hud);
    parent.appendChild(root);

    this.root = root;
    this.hud = hud;
    this.renderer = renderer;

    this.createScene();

    this.keyHandler = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (key === "c") {
        this.cycleCamera();
      } else if (key >= "1" && key <= "5") {
        this.setCameraMode(CAMERA_MODES[Number(key) - 1]);
      }
    };
    window.addEventListener("keydown", this.keyHandler);

    this.updateCameraLabel();
    this.startLoop();
  }

  dispose(): void {
    if (this.animationId !== null) {
      window.cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    if (this.keyHandler) {
      window.removeEventListener("keydown", this.keyHandler);
      this.keyHandler = undefined;
    }

    this.cars.clear();
    if (this.scene) {
      this.scene.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
      });
      this.scene.clear();
    }
    this.renderer?.dispose();
    this.root?.remove();

    this.root = undefined;
    this.hud = undefined;
    this.renderer = undefined;
    this.scene = undefined;
    this.camera = undefined;
    this.trackGroup = undefined;
    this.carGroup = undefined;
    this.skidGroup = undefined;
    this.skidPool = [];
    this.state = null;
    this.trackBuilt = false;
  }

  // ---- public state feed ----------------------------------------------

  setState(state: DriftRacerState | null, en: boolean): void {
    this.en = en;
    this.state = state;
    if (!state) {
      return;
    }

    if (!this.trackBuilt) {
      this.offsetX = (state.worldWidth * WORLD_SCALE) / 2;
      this.offsetZ = (state.worldHeight * WORLD_SCALE) / 2;
      this.buildTrack(state);
      this.trackBuilt = true;
    }

    this.syncCars(state);
    this.updateHud(state);
  }

  private sx(worldX: number): number {
    return worldX * WORLD_SCALE - this.offsetX;
  }

  private sz(worldY: number): number {
    return worldY * WORLD_SCALE - this.offsetZ;
  }

  // ---- scene / environment --------------------------------------------

  private createScene(): void {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#b8cfe0");
    scene.fog = new THREE.Fog("#b8cfe0", 90, 190);

    const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 600);
    camera.position.copy(this.camPos);
    camera.lookAt(this.camLook);

    scene.add(new THREE.HemisphereLight("#ffffff", "#41584f", 1.0));
    const sun = new THREE.DirectionalLight("#fff6e0", 2.0);
    sun.position.set(26, 48, 18);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 160;
    const span = 46;
    sun.shadow.camera.left = -span;
    sun.shadow.camera.right = span;
    sun.shadow.camera.top = span;
    sun.shadow.camera.bottom = -span;
    sun.shadow.bias = -0.0004;
    scene.add(sun);

    const mat = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200),
      new THREE.MeshStandardMaterial({ color: "#2f6f60", roughness: 0.95, metalness: 0 })
    );
    mat.rotation.x = -Math.PI / 2;
    mat.position.y = -0.02;
    mat.receiveShadow = true;
    scene.add(mat);

    const grid = new THREE.GridHelper(200, 100, 0x3f8576, 0x3a7a6b);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.32;
    scene.add(grid);

    const trackGroup = new THREE.Group();
    const carGroup = new THREE.Group();
    const skidGroup = new THREE.Group();
    scene.add(trackGroup, skidGroup, carGroup);

    this.scene = scene;
    this.camera = camera;
    this.trackGroup = trackGroup;
    this.carGroup = carGroup;
    this.skidGroup = skidGroup;
    this.buildSkidPool();
    this.cars.clear();
  }

  private buildSkidPool(): void {
    if (!this.skidGroup) return;
    const geometry = new THREE.PlaneGeometry(0.34, 0.18);
    for (let i = 0; i < SKID_POOL; i += 1) {
      const material = new THREE.MeshBasicMaterial({
        color: 0x141414,
        transparent: true,
        opacity: 0,
        depthWrite: false
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = 0.028;
      mesh.visible = false;
      this.skidGroup.add(mesh);
      this.skidPool.push({ mesh, born: 0 });
    }
  }

  // ---- track -----------------------------------------------------------

  private buildTrack(state: DriftRacerState): void {
    const group = this.trackGroup;
    if (!group) return;

    const points = state.track;
    const count = points.length;
    const halfWidth = (state.trackWidth * WORLD_SCALE) / 2;
    this.halfWidthScene = halfWidth;
    this.trackLen = state.trackLength;

    const centre: THREE.Vector2[] = points.map((p) => new THREE.Vector2(this.sx(p.x), this.sz(p.y)));
    const normals: THREE.Vector2[] = centre.map((_, i) => {
      const prev = centre[(i - 1 + count) % count];
      const next = centre[(i + 1) % count];
      const tx = next.x - prev.x;
      const tz = next.y - prev.y;
      const len = Math.hypot(tx, tz) || 1;
      return new THREE.Vector2(-tz / len, tx / len);
    });
    this.trackCentre = centre;
    this.trackNormals = normals;
    this.trackDistances = points.map((p) => p.distance);

    // Road surface ribbon.
    const roadPos: number[] = [];
    const roadIndex: number[] = [];
    for (let i = 0; i < count; i += 1) {
      const c = centre[i];
      const n = normals[i];
      roadPos.push(c.x + n.x * halfWidth, 0.02, c.y + n.y * halfWidth);
      roadPos.push(c.x - n.x * halfWidth, 0.02, c.y - n.y * halfWidth);
    }
    for (let i = 0; i < count; i += 1) {
      const a = i * 2;
      const b = i * 2 + 1;
      const cIdx = ((i + 1) % count) * 2;
      const d = ((i + 1) % count) * 2 + 1;
      roadIndex.push(a, b, d, a, d, cIdx);
    }
    const roadGeo = new THREE.BufferGeometry();
    roadGeo.setAttribute("position", new THREE.Float32BufferAttribute(roadPos, 3));
    roadGeo.setIndex(roadIndex);
    roadGeo.computeVertexNormals();
    const road = new THREE.Mesh(
      roadGeo,
      new THREE.MeshStandardMaterial({ color: "#3b414e", roughness: 0.9, metalness: 0.02 })
    );
    road.receiveShadow = true;
    group.add(road);

    // Curbs + barriers (Banden) on both sides.
    group.add(this.buildCurb(centre, normals, halfWidth, 1));
    group.add(this.buildCurb(centre, normals, halfWidth, -1));
    const wallHeight = state.wallHeight * WORLD_SCALE;
    group.add(this.buildWall(centre, normals, halfWidth, wallHeight, 1));
    group.add(this.buildWall(centre, normals, halfWidth, wallHeight, -1));

    // Dashed centre line.
    const dashGeo = new THREE.PlaneGeometry(0.5, 0.1);
    const dashMat = new THREE.MeshBasicMaterial({ color: 0xf8fafc, transparent: true, opacity: 0.5 });
    for (let i = 0; i < count; i += 3) {
      const c = centre[i];
      const n = normals[i];
      const dash = new THREE.Mesh(dashGeo, dashMat);
      dash.rotation.x = -Math.PI / 2;
      dash.rotation.z = Math.atan2(n.x, n.y);
      dash.position.set(c.x, 0.03, c.y);
      group.add(dash);
    }

    // Start / finish checkered band.
    group.add(this.buildStartLine(centre[0], normals[0], halfWidth));

    // Jump ramps (Sprungschanzen).
    for (const ramp of state.ramps) {
      group.add(this.buildRamp(ramp.startDistance, ramp.length, ramp.peak));
    }
  }

  private buildCurb(
    centre: THREE.Vector2[],
    normals: THREE.Vector2[],
    halfWidth: number,
    side: number
  ): THREE.Mesh {
    const count = centre.length;
    const inner = halfWidth;
    const outer = halfWidth + 0.32;
    const pos: number[] = [];
    const colors: number[] = [];
    const index: number[] = [];
    const red = new THREE.Color("#ef4444");
    const white = new THREE.Color("#f8fafc");
    for (let i = 0; i < count; i += 1) {
      const c = centre[i];
      const n = normals[i];
      pos.push(c.x + n.x * inner * side, 0.035, c.y + n.y * inner * side);
      pos.push(c.x + n.x * outer * side, 0.035, c.y + n.y * outer * side);
      const col = i % 2 === 0 ? red : white;
      colors.push(col.r, col.g, col.b, col.r, col.g, col.b);
    }
    for (let i = 0; i < count; i += 1) {
      const a = i * 2;
      const b = i * 2 + 1;
      const cIdx = ((i + 1) % count) * 2;
      const d = ((i + 1) % count) * 2 + 1;
      index.push(a, b, d, a, d, cIdx);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geo.setIndex(index);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 }));
    mesh.receiveShadow = true;
    return mesh;
  }

  private buildWall(
    centre: THREE.Vector2[],
    normals: THREE.Vector2[],
    halfWidth: number,
    wallHeight: number,
    side: number
  ): THREE.Mesh {
    const count = centre.length;
    const off = halfWidth + 0.36;
    const pos: number[] = [];
    const colors: number[] = [];
    const index: number[] = [];
    const red = new THREE.Color("#dc2626");
    const white = new THREE.Color("#f1f5f9");
    for (let i = 0; i < count; i += 1) {
      const c = centre[i];
      const n = normals[i];
      const bx = c.x + n.x * off * side;
      const bz = c.y + n.y * off * side;
      pos.push(bx, 0, bz); // base
      pos.push(bx, wallHeight, bz); // top
      const col = Math.floor(i / 2) % 2 === 0 ? red : white;
      colors.push(col.r, col.g, col.b, col.r, col.g, col.b);
    }
    for (let i = 0; i < count; i += 1) {
      const a = i * 2;
      const b = i * 2 + 1;
      const cIdx = ((i + 1) % count) * 2;
      const d = ((i + 1) % count) * 2 + 1;
      index.push(a, b, d, a, d, cIdx);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geo.setIndex(index);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, side: THREE.DoubleSide })
    );
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  private buildStartLine(centre: THREE.Vector2, normal: THREE.Vector2, halfWidth: number): THREE.Mesh {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 16;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      const cols = 16;
      const rows = 4;
      const cw = canvas.width / cols;
      const ch = canvas.height / rows;
      for (let r = 0; r < rows; r += 1) {
        for (let c = 0; c < cols; c += 1) {
          ctx.fillStyle = (r + c) % 2 === 0 ? "#0f172a" : "#f8fafc";
          ctx.fillRect(c * cw, r * ch, cw, ch);
        }
      }
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = THREE.NearestFilter;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(halfWidth * 2, 0.7),
      new THREE.MeshBasicMaterial({ map: texture })
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = Math.atan2(normal.x, normal.y);
    mesh.position.set(centre.x, 0.032, centre.y);
    return mesh;
  }

  /** Sample scene-space centreline position + normal at a world distance. */
  private sampleCentre(distance: number): { x: number; z: number; nx: number; nz: number } {
    const len = this.trackLen;
    const d = ((distance % len) + len) % len;
    const dist = this.trackDistances;
    const count = this.trackCentre.length;
    let i = 0;
    for (let k = 0; k < count; k += 1) {
      const a = dist[k];
      const b = k + 1 < count ? dist[k + 1] : len;
      if (d >= a && d < b) {
        i = k;
        break;
      }
    }
    const a = dist[i];
    const b = i + 1 < count ? dist[i + 1] : len;
    const t = b > a ? (d - a) / (b - a) : 0;
    const c0 = this.trackCentre[i];
    const c1 = this.trackCentre[(i + 1) % count];
    const n0 = this.trackNormals[i];
    const n1 = this.trackNormals[(i + 1) % count];
    return {
      x: c0.x + (c1.x - c0.x) * t,
      z: c0.y + (c1.y - c0.y) * t,
      nx: n0.x + (n1.x - n0.x) * t,
      nz: n0.y + (n1.y - n0.y) * t
    };
  }

  private buildRamp(startDistance: number, length: number, peak: number): THREE.Group {
    const grp = new THREE.Group();
    const steps = 12;
    const hw = this.halfWidthScene;
    const peakScene = peak * WORLD_SCALE;

    const lt: THREE.Vector3[] = [];
    const rt: THREE.Vector3[] = [];
    for (let s = 0; s <= steps; s += 1) {
      const t = s / steps;
      const c = this.sampleCentre(startDistance + length * t);
      const h = peakScene * t;
      lt.push(new THREE.Vector3(c.x + c.nx * hw, h + 0.02, c.z + c.nz * hw));
      rt.push(new THREE.Vector3(c.x - c.nx * hw, h + 0.02, c.z - c.nz * hw));
    }

    // Deck surface.
    const deckPos: number[] = [];
    const deckIdx: number[] = [];
    for (let s = 0; s <= steps; s += 1) {
      deckPos.push(lt[s].x, lt[s].y, lt[s].z, rt[s].x, rt[s].y, rt[s].z);
    }
    for (let s = 0; s < steps; s += 1) {
      const a = s * 2;
      const b = s * 2 + 1;
      const c = (s + 1) * 2;
      const d = (s + 1) * 2 + 1;
      deckIdx.push(a, b, d, a, d, c);
    }
    const deckGeo = new THREE.BufferGeometry();
    deckGeo.setAttribute("position", new THREE.Float32BufferAttribute(deckPos, 3));
    deckGeo.setIndex(deckIdx);
    deckGeo.computeVertexNormals();
    const deck = new THREE.Mesh(
      deckGeo,
      new THREE.MeshStandardMaterial({ color: "#f59e0b", roughness: 0.6, side: THREE.DoubleSide })
    );
    deck.castShadow = true;
    deck.receiveShadow = true;
    grp.add(deck);

    // Dark skirt: side walls + take-off lip face.
    const skirtPos: number[] = [];
    const skirtIdx: number[] = [];
    const push = (v: THREE.Vector3) => {
      skirtPos.push(v.x, v.y, v.z);
      return skirtPos.length / 3 - 1;
    };
    for (let s = 0; s < steps; s += 1) {
      // left side
      const l0 = push(lt[s]);
      const l0g = push(new THREE.Vector3(lt[s].x, 0, lt[s].z));
      const l1 = push(lt[s + 1]);
      const l1g = push(new THREE.Vector3(lt[s + 1].x, 0, lt[s + 1].z));
      skirtIdx.push(l0, l0g, l1g, l0, l1g, l1);
      // right side
      const r0 = push(rt[s]);
      const r0g = push(new THREE.Vector3(rt[s].x, 0, rt[s].z));
      const r1 = push(rt[s + 1]);
      const r1g = push(new THREE.Vector3(rt[s + 1].x, 0, rt[s + 1].z));
      skirtIdx.push(r0, r1g, r0g, r0, r1, r1g);
    }
    // lip end cap (vertical take-off face)
    const e = steps;
    const a0 = push(lt[e]);
    const a1 = push(rt[e]);
    const a2 = push(new THREE.Vector3(rt[e].x, 0, rt[e].z));
    const a3 = push(new THREE.Vector3(lt[e].x, 0, lt[e].z));
    skirtIdx.push(a0, a1, a2, a0, a2, a3);
    const skirtGeo = new THREE.BufferGeometry();
    skirtGeo.setAttribute("position", new THREE.Float32BufferAttribute(skirtPos, 3));
    skirtGeo.setIndex(skirtIdx);
    skirtGeo.computeVertexNormals();
    const skirt = new THREE.Mesh(
      skirtGeo,
      new THREE.MeshStandardMaterial({ color: "#b45309", roughness: 0.8, side: THREE.DoubleSide })
    );
    skirt.castShadow = true;
    grp.add(skirt);

    return grp;
  }

  // ---- cars ------------------------------------------------------------

  private createCar(color: string): CarView {
    const group = new THREE.Group();
    const body = new THREE.Group();
    group.add(body);

    const paint = parseColor(color);

    const chassis = new THREE.Mesh(
      new THREE.BoxGeometry(1.18, 0.26, 0.62),
      new THREE.MeshStandardMaterial({ color: paint, roughness: 0.45, metalness: 0.15 })
    );
    chassis.position.y = 0.24;
    chassis.castShadow = true;
    body.add(chassis);

    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(0.52, 0.22, 0.5),
      new THREE.MeshStandardMaterial({ color: "#dbeafe", roughness: 0.2, metalness: 0.3 })
    );
    cabin.position.set(0.02, 0.46, 0);
    cabin.castShadow = true;
    body.add(cabin);

    const nose = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.14, 0.66),
      new THREE.MeshStandardMaterial({ color: paint.clone().offsetHSL(0, 0, -0.08), roughness: 0.5 })
    );
    nose.position.set(0.58, 0.18, 0);
    nose.castShadow = true;
    body.add(nose);

    const spoiler = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.18, 0.7),
      new THREE.MeshStandardMaterial({ color: "#1f2937", roughness: 0.6 })
    );
    spoiler.position.set(-0.6, 0.42, 0);
    spoiler.castShadow = true;
    body.add(spoiler);

    const antenna = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.012, 0.5, 6),
      new THREE.MeshStandardMaterial({ color: "#111827" })
    );
    antenna.position.set(-0.45, 0.74, 0.22);
    body.add(antenna);
    const ball = new THREE.Mesh(
      new THREE.SphereGeometry(0.05, 10, 10),
      new THREE.MeshStandardMaterial({ color: paint, emissive: paint, emissiveIntensity: 0.4 })
    );
    ball.position.set(-0.45, 1.0, 0.22);
    body.add(ball);

    const boostFlame = new THREE.Mesh(
      new THREE.ConeGeometry(0.16, 0.6, 12),
      new THREE.MeshBasicMaterial({
        color: "#fb923c",
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
    );
    boostFlame.rotation.z = Math.PI / 2;
    boostFlame.position.set(-0.95, 0.22, 0);
    boostFlame.visible = false;
    body.add(boostFlame);

    const wheelGeo = new THREE.CylinderGeometry(0.19, 0.19, 0.14, 16);
    wheelGeo.rotateX(Math.PI / 2);
    const wheelMat = new THREE.MeshStandardMaterial({ color: "#0f172a", roughness: 0.85 });
    const hubMat = new THREE.MeshStandardMaterial({ color: "#e5e7eb", roughness: 0.4, metalness: 0.4 });

    const wheels: THREE.Mesh[] = [];
    const frontPivots: THREE.Group[] = [];
    const offsets: { x: number; z: number; front: boolean }[] = [
      { x: 0.42, z: 0.34, front: true },
      { x: 0.42, z: -0.34, front: true },
      { x: -0.42, z: 0.34, front: false },
      { x: -0.42, z: -0.34, front: false }
    ];
    for (const off of offsets) {
      const wheel = new THREE.Mesh(wheelGeo, wheelMat);
      wheel.castShadow = true;
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.16, 10), hubMat);
      hub.rotateX(Math.PI / 2);
      wheel.add(hub);
      if (off.front) {
        const pivot = new THREE.Group();
        pivot.position.set(off.x, 0.19, off.z);
        pivot.add(wheel);
        group.add(pivot);
        frontPivots.push(pivot);
      } else {
        wheel.position.set(off.x, 0.19, off.z);
        group.add(wheel);
      }
      wheels.push(wheel);
    }

    return {
      group,
      body,
      frontPivots,
      wheels,
      boostFlame,
      color,
      x: 0,
      z: 0,
      height: 0,
      angle: 0,
      targetX: 0,
      targetZ: 0,
      targetHeight: 0,
      targetAngle: 0,
      speed: 0,
      steer: 0,
      vz: 0,
      airborne: false,
      drifting: false,
      boost: false,
      finished: false,
      wheelSpin: 0,
      lastSkid: new THREE.Vector2(0, 0)
    };
  }

  private syncCars(state: DriftRacerState): void {
    const carGroup = this.carGroup;
    if (!carGroup) return;

    const seen = new Set<string>();
    for (const racer of state.racers) {
      seen.add(racer.playerId);
      let car = this.cars.get(racer.playerId);
      if (!car) {
        car = this.createCar(racer.color);
        carGroup.add(car.group);
        car.x = this.sx(racer.x);
        car.z = this.sz(racer.y);
        car.angle = racer.angleRad;
        car.lastSkid.set(car.x, car.z);
        this.cars.set(racer.playerId, car);
      }
      car.targetX = this.sx(racer.x);
      car.targetZ = this.sz(racer.y);
      car.targetHeight = racer.z * WORLD_SCALE;
      car.targetAngle = racer.angleRad;
      car.speed = racer.speed;
      car.steer = racer.steerInput;
      car.vz = racer.vz;
      car.airborne = racer.airborne;
      car.drifting = racer.drifting;
      car.boost = racer.boostActive;
      car.finished = racer.finished;
    }

    for (const [playerId, car] of this.cars) {
      if (!seen.has(playerId)) {
        carGroup.remove(car.group);
        disposeObject(car.group);
        this.cars.delete(playerId);
      }
    }
  }

  // ---- render loop -----------------------------------------------------

  private startLoop(): void {
    this.lastFrame = performance.now();
    const loop = () => {
      this.animationId = window.requestAnimationFrame(loop);
      const now = performance.now();
      const dt = Math.min(0.05, Math.max(0.0001, (now - this.lastFrame) / 1000));
      this.lastFrame = now;
      this.update(dt, now);
    };
    loop();
  }

  private update(dt: number, now: number): void {
    const renderer = this.renderer;
    const scene = this.scene;
    const camera = this.camera;
    if (!renderer || !scene || !camera) return;

    this.ensureSize();

    const posK = 1 - Math.exp(-POS_LERP_RATE * dt);
    const angK = 1 - Math.exp(-ANGLE_LERP_RATE * dt);
    const hK = 1 - Math.exp(-HEIGHT_LERP_RATE * dt);

    for (const car of this.cars.values()) {
      car.x += (car.targetX - car.x) * posK;
      car.z += (car.targetZ - car.z) * posK;
      car.height += (car.targetHeight - car.height) * hK;
      car.angle += shortestAngleDelta(car.angle, car.targetAngle) * angK;

      car.group.position.set(car.x, car.height, car.z);
      car.group.rotation.y = -car.angle;

      const sceneSpeed = car.speed * WORLD_SCALE;
      car.wheelSpin -= (sceneSpeed / 0.19) * dt;
      for (const wheel of car.wheels) {
        wheel.rotation.z = car.wheelSpin;
      }
      const steerAngle = car.steer * 0.5;
      for (const pivot of car.frontPivots) {
        pivot.rotation.y = steerAngle;
      }

      // Roll into the corner (x), pitch from vertical velocity (z).
      const roll = car.steer * (car.drifting ? 0.22 : 0.08);
      const pitch = clamp(car.vz * 0.0016, -0.5, 0.5);
      car.body.rotation.set(roll, 0, pitch);

      car.boostFlame.visible = car.boost;
      if (car.boost) {
        const flick = 0.8 + Math.sin(now * 0.05) * 0.25;
        car.boostFlame.scale.set(flick, 1, 1);
      }

      if (car.drifting && !car.airborne && !car.finished) {
        const moved = Math.hypot(car.x - car.lastSkid.x, car.z - car.lastSkid.y);
        if (moved > SKID_MIN_STEP) {
          this.placeSkid(car, now);
          car.lastSkid.set(car.x, car.z);
        }
      }
    }

    this.fadeSkids(now);
    this.updateCamera(dt, now);
    renderer.render(scene, camera);
  }

  private placeSkid(car: CarView, now: number): void {
    if (this.skidPool.length === 0) return;
    const cos = Math.cos(-car.angle);
    const sin = Math.sin(-car.angle);
    for (const lz of [0.34, -0.34]) {
      const lx = -0.42;
      const wx = car.x + lx * cos - lz * sin;
      const wz = car.z + lx * sin + lz * cos;
      const entry = this.skidPool[this.skidCursor];
      this.skidCursor = (this.skidCursor + 1) % this.skidPool.length;
      entry.born = now;
      entry.mesh.visible = true;
      entry.mesh.position.set(wx, 0.028, wz);
      entry.mesh.rotation.x = -Math.PI / 2;
      entry.mesh.rotation.z = -car.angle;
    }
  }

  private fadeSkids(now: number): void {
    for (const entry of this.skidPool) {
      if (!entry.mesh.visible) continue;
      const age = now - entry.born;
      if (age >= SKID_LIFE_MS) {
        entry.mesh.visible = false;
        continue;
      }
      (entry.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - age / SKID_LIFE_MS) * 0.5;
    }
  }

  // ---- camera ----------------------------------------------------------

  private cycleCamera(): void {
    const index = CAMERA_MODES.indexOf(this.cameraMode);
    this.setCameraMode(CAMERA_MODES[(index + 1) % CAMERA_MODES.length]);
  }

  private setCameraMode(mode: CameraMode): void {
    this.cameraMode = mode;
    this.updateCameraLabel();
  }

  private findLeader(): CarView | null {
    const state = this.state;
    if (!state || state.racers.length === 0) return null;
    let leader = state.racers[0];
    for (const racer of state.racers) {
      if (racer.rank < leader.rank) leader = racer;
    }
    return this.cars.get(leader.playerId) ?? null;
  }

  private centroid(): THREE.Vector3 {
    const out = new THREE.Vector3();
    if (this.cars.size === 0) return out;
    for (const car of this.cars.values()) {
      out.x += car.x;
      out.z += car.z;
    }
    out.x /= this.cars.size;
    out.z /= this.cars.size;
    return out;
  }

  private updateCamera(dt: number, now: number): void {
    const camera = this.camera;
    if (!camera) return;

    const targetPos = new THREE.Vector3();
    const targetLook = new THREE.Vector3();
    let rate = 4;

    const leader = this.findLeader();

    if (this.cameraMode === "dynamic") {
      // Frame ALL cars so every player always sees their car (shared screen).
      const cars = [...this.cars.values()];
      let cx = 0;
      let cz = 0;
      let maxH = 0;
      for (const c of cars) {
        cx += c.x;
        cz += c.z;
        maxH = Math.max(maxH, c.height);
      }
      const n = Math.max(1, cars.length);
      cx /= n;
      cz /= n;
      let radius = 9;
      for (const c of cars) {
        radius = Math.max(radius, Math.hypot(c.x - cx, c.z - cz) + 4);
      }
      const halfV = (50 * Math.PI) / 180 / 2;
      const dist = clamp(radius / Math.tan(halfV) * 1.12, 18, 78);
      const pitch = (53 * Math.PI) / 180;
      targetPos.set(cx, dist * Math.sin(pitch) + maxH * 0.5, cz + dist * Math.cos(pitch));
      targetLook.set(cx, 0, cz);
      rate = 2.6;
    } else if ((this.cameraMode === "cinematic" || this.cameraMode === "chase") && leader) {
      const a = leader.angle;
      const fwd = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      const pos = new THREE.Vector3(leader.x, leader.height, leader.z);
      if (this.cameraMode === "cinematic") {
        targetPos.copy(pos).addScaledVector(fwd, -5.6).add(new THREE.Vector3(0, 2.6, 0));
        targetLook.copy(pos).addScaledVector(fwd, 3.2).add(new THREE.Vector3(0, 0.4, 0));
        rate = 5;
      } else {
        targetPos.copy(pos).addScaledVector(fwd, -7.6).add(new THREE.Vector3(0, 4.8, 0));
        targetLook.copy(pos).addScaledVector(fwd, 1.5);
        rate = 4;
      }
    } else if (this.cameraMode === "topdown") {
      const c = this.centroid();
      targetPos.set(c.x, 40, c.z + 0.01);
      targetLook.set(c.x, 0, c.z);
      rate = 3.5;
    } else {
      const orbit = now * 0.00006;
      targetPos.set(Math.sin(orbit) * 20, 56, Math.cos(orbit) * 40);
      targetLook.set(0, 0, 0);
      rate = 1.4;
    }

    if (!this.cameraInitialised) {
      this.camPos.copy(targetPos);
      this.camLook.copy(targetLook);
      this.cameraInitialised = true;
    } else {
      const k = 1 - Math.exp(-rate * dt);
      this.camPos.lerp(targetPos, k);
      this.camLook.lerp(targetLook, k);
    }

    camera.position.copy(this.camPos);
    camera.lookAt(this.camLook);
  }

  private ensureSize(): void {
    const root = this.root;
    const renderer = this.renderer;
    const camera = this.camera;
    if (!root || !renderer || !camera) return;
    const width = Math.max(1, root.clientWidth);
    const height = Math.max(1, root.clientHeight);
    if (width === this.lastWidth && height === this.lastHeight) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    this.lastWidth = width;
    this.lastHeight = height;
  }

  // ---- HUD -------------------------------------------------------------

  private ensureHudStructure(): {
    board: HTMLDivElement;
    info: HTMLDivElement;
    banner: HTMLDivElement;
    hint: HTMLDivElement;
  } {
    const hud = this.hud!;
    let board = hud.querySelector<HTMLDivElement>("[data-board]");
    let info = hud.querySelector<HTMLDivElement>("[data-info]");
    let banner = hud.querySelector<HTMLDivElement>("[data-banner]");
    let hint = hud.querySelector<HTMLDivElement>("[data-hint]");

    if (!board) {
      board = document.createElement("div");
      board.dataset.board = "1";
      Object.assign(board.style, {
        position: "absolute",
        top: "18px",
        left: "18px",
        minWidth: "210px",
        padding: "12px 14px",
        borderRadius: "14px",
        background: "rgba(2,6,23,0.55)",
        backdropFilter: "blur(6px)",
        boxShadow: "0 6px 22px rgba(0,0,0,0.35)"
      } satisfies Partial<CSSStyleDeclaration>);
      hud.appendChild(board);
    }
    if (!info) {
      info = document.createElement("div");
      info.dataset.info = "1";
      Object.assign(info.style, {
        position: "absolute",
        top: "18px",
        right: "18px",
        textAlign: "right",
        padding: "12px 14px",
        borderRadius: "14px",
        background: "rgba(2,6,23,0.55)",
        backdropFilter: "blur(6px)",
        boxShadow: "0 6px 22px rgba(0,0,0,0.35)"
      } satisfies Partial<CSSStyleDeclaration>);
      hud.appendChild(info);
    }
    if (!banner) {
      banner = document.createElement("div");
      banner.dataset.banner = "1";
      Object.assign(banner.style, {
        position: "absolute",
        top: "26%",
        left: "0",
        right: "0",
        textAlign: "center",
        fontSize: "clamp(34px, 6vw, 76px)",
        fontWeight: "900",
        letterSpacing: "2px",
        textShadow: "0 4px 18px rgba(0,0,0,0.6)",
        display: "none"
      } satisfies Partial<CSSStyleDeclaration>);
      hud.appendChild(banner);
    }
    if (!hint) {
      hint = document.createElement("div");
      hint.dataset.hint = "1";
      Object.assign(hint.style, {
        position: "absolute",
        bottom: "16px",
        left: "18px",
        fontSize: "13px",
        opacity: "0.75",
        background: "rgba(2,6,23,0.4)",
        padding: "6px 10px",
        borderRadius: "10px"
      } satisfies Partial<CSSStyleDeclaration>);
      hud.appendChild(hint);
    }

    return { board, info, banner, hint };
  }

  private updateCameraLabel(): void {
    if (!this.hud) return;
    const { hint } = this.ensureHudStructure();
    const label = CAMERA_LABELS[this.cameraMode][this.en ? "en" : "de"];
    hint.textContent = (this.en ? "Camera (C): " : "Kamera (C): ") + label;
  }

  private updateHud(state: DriftRacerState): void {
    if (!this.hud) return;
    const { board, info, banner } = this.ensureHudStructure();
    const en = this.en;

    const ranked = [...state.racers].sort((a, b) => a.rank - b.rank);

    board.innerHTML = "";
    const title = document.createElement("div");
    title.textContent = en ? "Standings" : "Platzierung";
    Object.assign(title.style, {
      fontSize: "12px",
      letterSpacing: "1px",
      textTransform: "uppercase",
      opacity: "0.65",
      marginBottom: "8px"
    } satisfies Partial<CSSStyleDeclaration>);
    board.appendChild(title);

    ranked.forEach((racer, index) => {
      const row = document.createElement("div");
      Object.assign(row.style, {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "3px 0",
        fontSize: "15px",
        fontWeight: "700",
        opacity: racer.finished ? "0.7" : "1"
      } satisfies Partial<CSSStyleDeclaration>);

      const pos = document.createElement("span");
      pos.textContent = String(index + 1);
      Object.assign(pos.style, { width: "16px", opacity: "0.7" } satisfies Partial<CSSStyleDeclaration>);

      const dot = document.createElement("span");
      Object.assign(dot.style, {
        width: "12px",
        height: "12px",
        borderRadius: "50%",
        background: racer.color,
        boxShadow: "0 0 8px " + racer.color
      } satisfies Partial<CSSStyleDeclaration>);

      const name = document.createElement("span");
      name.textContent = racer.name;
      Object.assign(name.style, { flex: "1", whiteSpace: "nowrap" } satisfies Partial<CSSStyleDeclaration>);

      const lap = document.createElement("span");
      const lapNum = Math.min(state.lapsToWin, racer.finished ? state.lapsToWin : racer.lap + 1);
      lap.textContent = lapNum + "/" + state.lapsToWin;
      Object.assign(lap.style, { opacity: "0.75", fontVariantNumeric: "tabular-nums" } satisfies Partial<CSSStyleDeclaration>);

      row.append(pos, dot, name, lap);
      board.appendChild(row);
    });

    const leader = ranked[0];
    const elapsed = Math.floor(state.elapsedMs / 1000);
    const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
    const ss = String(elapsed % 60).padStart(2, "0");
    const speed = leader ? Math.round(Math.abs(leader.speed) * 0.18) : 0;
    info.innerHTML = "";
    const lapLine = document.createElement("div");
    lapLine.style.fontSize = "26px";
    lapLine.style.fontWeight = "900";
    const leadLap = leader ? Math.min(state.lapsToWin, leader.finished ? state.lapsToWin : leader.lap + 1) : 1;
    lapLine.textContent = (en ? "Lap" : "Runde") + " " + leadLap + "/" + state.lapsToWin;
    const timeLine = document.createElement("div");
    timeLine.style.fontSize = "15px";
    timeLine.style.opacity = "0.8";
    timeLine.textContent = (en ? "Time" : "Zeit") + " " + mm + ":" + ss;
    const speedLine = document.createElement("div");
    speedLine.style.fontSize = "15px";
    speedLine.style.opacity = "0.8";
    speedLine.textContent = (en ? "Lead speed" : "Tempo") + " " + speed;
    info.append(lapLine, timeLine, speedLine);

    if (state.winnerName) {
      banner.style.display = "block";
      banner.style.color = "#fde047";
      banner.textContent = state.isTimedOut
        ? state.winnerName + " " + (en ? "leads!" : "führt!")
        : state.winnerName + " " + (en ? "wins!" : "gewinnt!");
    } else {
      banner.style.display = "none";
    }

    this.updateCameraLabel();
  }
}
