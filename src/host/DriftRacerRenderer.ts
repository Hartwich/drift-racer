import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type {
  DriftRacerPickupState,
  DriftRacerProjectileState,
  DriftRacerRacerState,
  DriftRacerState
} from "../protocol.js";

/**
 * Full 3D renderer for Drift Racer (beach / desert theme).
 *
 * Renders the server simulation as a 3D RC scene: textured sandy ground, a
 * textured road ribbon with curbs and barriers, jump ramps, beach props
 * (palms, boulders, bushes), item boxes + weapon projectiles, and real Kenney
 * Car-Kit GLB cars (with a procedural fallback). A cinematic flying camera
 * keeps every car framed so all players always see their car.
 */

const WORLD_SCALE = 0.02;
const POS_LERP_RATE = 14;
const ANGLE_LERP_RATE = 12;
const HEIGHT_LERP_RATE = 20;
const SKID_POOL = 240;
const SKID_LIFE_MS = 2600;
const SKID_MIN_STEP = 0.14;

const ASSET_BASE = "/drift-racer/cars";
const CAR_MODELS = [
  "race",
  "suv",
  "hatchback-sports",
  "police",
  "taxi",
  "van",
  "sedan-sports",
  "race-future"
];
const TARGET_CAR_LENGTH = 1.55;
const CAR_MODEL_YAW = Math.PI / 2;
const TEX_BASE = "/drift-racer/textures";
const NATURE_BASE = "/drift-racer/nature";

const CAMERA_MODES = ["dynamic", "cinematic", "chase", "overview", "topdown"] as const;
type CameraMode = (typeof CAMERA_MODES)[number];

const CAMERA_LABELS: Record<CameraMode, { de: string; en: string }> = {
  dynamic: { de: "Dynamisch (alle)", en: "Dynamic (all)" },
  cinematic: { de: "Cinematic", en: "Cinematic" },
  chase: { de: "Verfolgung", en: "Chase" },
  overview: { de: "Übersicht", en: "Overview" },
  topdown: { de: "Vogel", en: "Top-down" }
};

const WEAPON_ICON: Record<string, string> = { rocket: "🚀", mine: "💣", turbo: "⚡" };

interface PreviewCarData {
  colormap?: string;
  models?: Record<string, string>;
  textures?: Record<string, string>;
  nature?: Record<string, string>;
}
declare global {
  interface Window {
    __driftRacerCarData?: PreviewCarData;
  }
}

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
    if (Array.isArray(material)) material.forEach((m) => m.dispose());
    else if (material) material.dispose();
  });
}

// --- procedural canvas textures -------------------------------------------

function makeSandTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 512;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#d9c08a";
  ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 9000; i += 1) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const shade = Math.random();
    ctx.fillStyle = shade < 0.5 ? "rgba(160,130,80,0.20)" : "rgba(255,240,200,0.18)";
    ctx.fillRect(x, y, 1.6, 1.6);
  }
  for (let i = 0; i < 40; i += 1) {
    ctx.fillStyle = `rgba(150,120,75,${0.04 + Math.random() * 0.05})`;
    ctx.beginPath();
    ctx.arc(Math.random() * 512, Math.random() * 512, 20 + Math.random() * 60, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(28, 28);
  tex.anisotropy = 4;
  return tex;
}

function makeAsphaltTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#52514f";
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 6000; i += 1) {
    const g = 50 + Math.floor(Math.random() * 60);
    ctx.fillStyle = `rgba(${g},${g - 6},${g - 12},0.5)`;
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

function makeSkyTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = 16;
  c.height = 256;
  const ctx = c.getContext("2d")!;
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, "#2f6cb0");
  grad.addColorStop(0.45, "#7fb4e0");
  grad.addColorStop(0.8, "#cfe3f2");
  grad.addColorStop(1, "#f6e6c8");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 16, 256);
  return new THREE.CanvasTexture(c);
}

function makeItemBoxTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  const grad = ctx.createLinearGradient(0, 0, 128, 128);
  grad.addColorStop(0, "#fde047");
  grad.addColorStop(1, "#f97316");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.lineWidth = 8;
  ctx.strokeRect(8, 8, 112, 112);
  ctx.fillStyle = "#1f2937";
  ctx.font = "bold 86px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("?", 64, 70);
  return new THREE.CanvasTexture(c);
}

function makeWaterNormal(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(128, 128);
  for (let i = 0; i < 128 * 128; i += 1) {
    const n = (Math.random() - 0.5) * 36;
    img.data[i * 4] = 128 + n;
    img.data[i * 4 + 1] = 128 + n;
    img.data[i * 4 + 2] = 255;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(60, 60);
  return tex;
}

interface CarView {
  group: THREE.Group;
  tilt: THREE.Group;
  proceduralBody: THREE.Group;
  wheels: THREE.Mesh[];
  frontPivots: THREE.Group[];
  ring: THREE.Mesh;
  boostFlame: THREE.Mesh;
  modelLoaded: boolean;
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
  spunOut: boolean;
  prevSpunOut: boolean;
  wheelSpin: number;
}

export class DriftRacerRenderer {
  private root?: HTMLDivElement;
  private hud?: HTMLDivElement;
  private renderer?: THREE.WebGLRenderer;
  private scene?: THREE.Scene;
  private camera?: THREE.PerspectiveCamera;

  private trackGroup?: THREE.Group;
  private carGroup?: THREE.Group;
  private fxGroup?: THREE.Group;
  private skidGroup?: THREE.Group;
  private skidPool: { mesh: THREE.Mesh; born: number }[] = [];
  private skidCursor = 0;

  private readonly cars = new Map<string, CarView>();
  private readonly pickupMeshes = new Map<string, THREE.Object3D>();
  private readonly projectileMeshes = new Map<string, { obj: THREE.Object3D; tx: number; ty: number; tz: number }>();
  private explosionPool: { sprite: THREE.Sprite; born: number; active: boolean }[] = [];
  private explosionCursor = 0;

  private gltfLoader = new GLTFLoader();
  private colormapPromise?: Promise<THREE.Texture | null>;
  private readonly modelTemplates = new Map<string, Promise<THREE.Group | null>>();
  private itemBoxTexture?: THREE.Texture;
  private rockMaterial?: THREE.MeshStandardMaterial;
  private waterMaterial?: THREE.MeshStandardMaterial;
  private readonly natureTemplates = new Map<string, Promise<THREE.Group | null>>();

  private state: DriftRacerState | null = null;
  private en = false;
  private trackBuilt = false;
  private offsetX = 0;
  private offsetZ = 0;

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
      background: "#7fb4e0",
      pointerEvents: "none",
      zIndex: "1"
    } satisfies Partial<CSSStyleDeclaration>);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
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
    this.itemBoxTexture = makeItemBoxTexture();

    this.createScene();

    this.keyHandler = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (key === "c") this.cycleCamera();
      else if (key >= "1" && key <= "5") this.setCameraMode(CAMERA_MODES[Number(key) - 1]);
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
    this.pickupMeshes.clear();
    this.projectileMeshes.clear();
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
    this.fxGroup = undefined;
    this.skidGroup = undefined;
    this.skidPool = [];
    this.explosionPool = [];
    this.state = null;
    this.trackBuilt = false;
  }

  // ---- public state feed ----------------------------------------------

  setState(state: DriftRacerState | null, en: boolean): void {
    this.en = en;
    this.state = state;
    if (!state) return;

    if (!this.trackBuilt) {
      this.offsetX = (state.worldWidth * WORLD_SCALE) / 2;
      this.offsetZ = (state.worldHeight * WORLD_SCALE) / 2;
      this.buildTrack(state);
      this.trackBuilt = true;
    }

    this.syncCars(state);
    this.syncPickups(state);
    this.syncProjectiles(state);
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
    scene.background = new THREE.Color("#86b8e2");
    scene.fog = new THREE.Fog("#bfe0ea", 130, 340);

    const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 700);
    camera.position.copy(this.camPos);
    camera.lookAt(this.camLook);

    scene.add(new THREE.HemisphereLight("#fff4dd", "#6b5b3a", 0.95));
    const sun = new THREE.DirectionalLight("#fff1d0", 2.1);
    sun.position.set(34, 52, 20);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 180;
    const span = 50;
    sun.shadow.camera.left = -span;
    sun.shadow.camera.right = span;
    sun.shadow.camera.top = span;
    sun.shadow.camera.bottom = -span;
    sun.shadow.bias = -0.0004;
    scene.add(sun);

    // Environment reflections from a warm gradient.
    const renderer = this.renderer!;
    const pmrem = new THREE.PMREMGenerator(renderer);
    const skyTex = makeSkyTexture();
    skyTex.mapping = THREE.EquirectangularReflectionMapping;
    scene.environment = pmrem.fromEquirectangular(skyTex).texture;

    // Sky dome.
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(330, 32, 16),
      new THREE.MeshBasicMaterial({ map: makeSkyTexture(), side: THREE.BackSide, fog: false })
    );
    scene.add(dome);

    // Ocean around the island.
    const waterNormal = makeWaterNormal();
    const waterMat = new THREE.MeshStandardMaterial({
      color: "#1f74b8",
      roughness: 0.16,
      metalness: 0.0,
      normalMap: waterNormal,
      transparent: true,
      opacity: 0.94
    });
    waterMat.normalScale.set(0.4, 0.4);
    const water = new THREE.Mesh(new THREE.PlaneGeometry(640, 640), waterMat);
    water.rotation.x = -Math.PI / 2;
    water.position.y = -0.55;
    scene.add(water);
    this.waterMaterial = waterMat;

    this.setupRockMaterial();

    const trackGroup = new THREE.Group();
    const carGroup = new THREE.Group();
    const fxGroup = new THREE.Group();
    const skidGroup = new THREE.Group();
    scene.add(trackGroup, skidGroup, fxGroup, carGroup);

    this.scene = scene;
    this.camera = camera;
    this.trackGroup = trackGroup;
    this.carGroup = carGroup;
    this.fxGroup = fxGroup;
    this.skidGroup = skidGroup;
    this.buildSkidPool();
    this.buildExplosionPool();
    this.cars.clear();
  }

  private buildSkidPool(): void {
    if (!this.skidGroup) return;
    const geometry = new THREE.PlaneGeometry(0.34, 0.18);
    for (let i = 0; i < SKID_POOL; i += 1) {
      const material = new THREE.MeshBasicMaterial({ color: 0x1a140e, transparent: true, opacity: 0, depthWrite: false });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = 0.03;
      mesh.visible = false;
      this.skidGroup.add(mesh);
      this.skidPool.push({ mesh, born: 0 });
    }
  }

  private buildExplosionPool(): void {
    if (!this.fxGroup) return;
    const c = document.createElement("canvas");
    c.width = 64;
    c.height = 64;
    const ctx = c.getContext("2d")!;
    const grad = ctx.createRadialGradient(32, 32, 4, 32, 32, 30);
    grad.addColorStop(0, "rgba(255,247,200,0.95)");
    grad.addColorStop(0.4, "rgba(251,146,60,0.85)");
    grad.addColorStop(1, "rgba(120,40,10,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    for (let i = 0; i < 16; i += 1) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false }));
      sprite.visible = false;
      sprite.scale.setScalar(2);
      this.fxGroup.add(sprite);
      this.explosionPool.push({ sprite, born: 0, active: false });
    }
  }

  // ---- track + props ---------------------------------------------------

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

    // Road ribbon with UVs for the asphalt texture.
    const roadPos: number[] = [];
    const roadUv: number[] = [];
    const roadIndex: number[] = [];
    let dist = 0;
    for (let i = 0; i < count; i += 1) {
      const c = centre[i];
      const n = normals[i];
      if (i > 0) dist += centre[i].distanceTo(centre[i - 1]);
      roadPos.push(c.x + n.x * halfWidth, 0.02, c.y + n.y * halfWidth);
      roadPos.push(c.x - n.x * halfWidth, 0.02, c.y - n.y * halfWidth);
      const v = dist / 4;
      roadUv.push(0, v, 1, v);
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
    roadGeo.setAttribute("uv", new THREE.Float32BufferAttribute(roadUv, 2));
    roadGeo.setIndex(roadIndex);
    roadGeo.computeVertexNormals();
    const road = new THREE.Mesh(roadGeo, new THREE.MeshStandardMaterial({ map: makeAsphaltTexture(), roughness: 0.95, metalness: 0.02 }));
    road.receiveShadow = true;
    group.add(road);

    group.add(this.buildCurb(centre, normals, halfWidth, 1));
    group.add(this.buildCurb(centre, normals, halfWidth, -1));
    const wallHeight = state.wallHeight * WORLD_SCALE;
    group.add(this.buildWall(centre, normals, halfWidth, wallHeight, 1));
    group.add(this.buildWall(centre, normals, halfWidth, wallHeight, -1));

    group.add(this.buildStartLine(centre[0], normals[0], halfWidth));

    for (const ramp of state.ramps) {
      group.add(this.buildRamp(ramp.startDistance, ramp.length, ramp.peak));
    }

    this.buildProps(group, centre, normals, halfWidth);
    this.buildIsland(centre);
    this.addInfieldProps(centre, halfWidth);
  }

  private buildCurb(centre: THREE.Vector2[], normals: THREE.Vector2[], halfWidth: number, side: number): THREE.Mesh {
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

  private buildWall(centre: THREE.Vector2[], normals: THREE.Vector2[], halfWidth: number, wallHeight: number, side: number): THREE.Object3D {
    const count = centre.length;
    const off = halfWidth + 0.32;
    const group = new THREE.Group();

    const pos: number[] = [];
    const index: number[] = [];
    for (let i = 0; i < count; i += 1) {
      const c = centre[i];
      const n = normals[i];
      const bx = c.x + n.x * off * side;
      const bz = c.y + n.y * off * side;
      pos.push(bx, 0, bz);
      pos.push(bx, wallHeight, bz);
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
    geo.setIndex(index);
    geo.computeVertexNormals();
    const body = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: "#eef2f7", roughness: 0.7, side: THREE.DoubleSide }));
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    const rpos: number[] = [];
    const ridx: number[] = [];
    const railOuter = off + 0.16;
    for (let i = 0; i < count; i += 1) {
      const c = centre[i];
      const n = normals[i];
      rpos.push(c.x + n.x * off * side, wallHeight + 0.01, c.y + n.y * off * side);
      rpos.push(c.x + n.x * railOuter * side, wallHeight + 0.01, c.y + n.y * railOuter * side);
    }
    for (let i = 0; i < count; i += 1) {
      const a = i * 2;
      const b = i * 2 + 1;
      const cIdx = ((i + 1) % count) * 2;
      const d = ((i + 1) % count) * 2 + 1;
      ridx.push(a, b, d, a, d, cIdx);
    }
    const rgeo = new THREE.BufferGeometry();
    rgeo.setAttribute("position", new THREE.Float32BufferAttribute(rpos, 3));
    rgeo.setIndex(ridx);
    rgeo.computeVertexNormals();
    const rail = new THREE.Mesh(rgeo, new THREE.MeshStandardMaterial({ color: "#e23b3b", roughness: 0.5, side: THREE.DoubleSide }));
    rail.castShadow = true;
    group.add(rail);

    return group;
  }

  private buildStartLine(centre: THREE.Vector2, normal: THREE.Vector2, halfWidth: number): THREE.Mesh {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 16;
    const ctx = canvas.getContext("2d")!;
    const cols = 16;
    const rows = 4;
    const cw = canvas.width / cols;
    const ch = canvas.height / rows;
    for (let r = 0; r < rows; r += 1) {
      for (let col = 0; col < cols; col += 1) {
        ctx.fillStyle = (r + col) % 2 === 0 ? "#0f172a" : "#f8fafc";
        ctx.fillRect(col * cw, r * ch, cw, ch);
      }
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = THREE.NearestFilter;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(halfWidth * 2, 0.7), new THREE.MeshBasicMaterial({ map: texture }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = Math.atan2(normal.x, normal.y);
    mesh.position.set(centre.x, 0.04, centre.y);
    return mesh;
  }

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
    const deckPos: number[] = [];
    const deckIdx: number[] = [];
    for (let s = 0; s <= steps; s += 1) deckPos.push(lt[s].x, lt[s].y, lt[s].z, rt[s].x, rt[s].y, rt[s].z);
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
    const deck = new THREE.Mesh(deckGeo, new THREE.MeshStandardMaterial({ color: "#e2b15a", roughness: 0.8, side: THREE.DoubleSide }));
    deck.castShadow = true;
    deck.receiveShadow = true;
    grp.add(deck);

    const skirtPos: number[] = [];
    const skirtIdx: number[] = [];
    const push = (v: THREE.Vector3) => {
      skirtPos.push(v.x, v.y, v.z);
      return skirtPos.length / 3 - 1;
    };
    for (let s = 0; s < steps; s += 1) {
      const l0 = push(lt[s]);
      const l0g = push(new THREE.Vector3(lt[s].x, 0, lt[s].z));
      const l1 = push(lt[s + 1]);
      const l1g = push(new THREE.Vector3(lt[s + 1].x, 0, lt[s + 1].z));
      skirtIdx.push(l0, l0g, l1g, l0, l1g, l1);
      const r0 = push(rt[s]);
      const r0g = push(new THREE.Vector3(rt[s].x, 0, rt[s].z));
      const r1 = push(rt[s + 1]);
      const r1g = push(new THREE.Vector3(rt[s + 1].x, 0, rt[s + 1].z));
      skirtIdx.push(r0, r1g, r0g, r0, r1, r1g);
    }
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
    const skirt = new THREE.Mesh(skirtGeo, new THREE.MeshStandardMaterial({ color: "#9a6b32", roughness: 0.9, side: THREE.DoubleSide }));
    skirt.castShadow = true;
    grp.add(skirt);
    return grp;
  }

  private buildProps(group: THREE.Group, centre: THREE.Vector2[], normals: THREE.Vector2[], halfWidth: number): void {
    const count = centre.length;
    const palm = this.makePalm();
    const boulder = this.makeBoulder();
    const bush = this.makeBush();
    let n = 0;
    for (let i = 0; i < count; i += 5) {
      const side = i % 2 === 0 ? 1 : -1;
      const c = centre[i];
      const nrm = normals[i];
      const dist = halfWidth + 1.4 + (n % 3) * 0.6;
      const px = c.x + nrm.x * dist * side;
      const pz = c.y + nrm.y * dist * side;
      const pick = n % 5;
      let proto: THREE.Object3D;
      if (pick === 0 || pick === 3) proto = palm;
      else if (pick === 1) proto = boulder;
      else proto = bush;
      const inst = proto.clone(true);
      inst.position.set(px, 0, pz);
      inst.rotation.y = Math.random() * Math.PI * 2;
      const s = 0.85 + Math.random() * 0.5;
      inst.scale.multiplyScalar(s);
      group.add(inst);
      n += 1;
    }
    this.scatterNature(centre, normals, halfWidth);
  }

  private makePalm(): THREE.Group {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.18, 2.2, 8),
      new THREE.MeshStandardMaterial({ color: "#9c6b3f", roughness: 0.9 })
    );
    trunk.position.y = 1.1;
    trunk.rotation.z = 0.12;
    trunk.castShadow = true;
    g.add(trunk);
    const frondMat = new THREE.MeshStandardMaterial({ color: "#3f9b46", roughness: 0.8, side: THREE.DoubleSide });
    for (let i = 0; i < 6; i += 1) {
      const frond = new THREE.Mesh(new THREE.ConeGeometry(0.28, 1.5, 4, 1, true), frondMat);
      frond.position.set(0, 2.1, 0);
      frond.rotation.z = Math.PI / 2.4;
      frond.rotation.y = (i / 6) * Math.PI * 2;
      frond.castShadow = true;
      g.add(frond);
    }
    const coco = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), new THREE.MeshStandardMaterial({ color: "#6b4a2a" }));
    coco.position.set(0, 2.0, 0.1);
    g.add(coco);
    return g;
  }

  private makeBoulder(): THREE.Group {
    const g = new THREE.Group();
    const geo = new THREE.IcosahedronGeometry(0.7, 1);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i += 1) {
      pos.setXYZ(i, pos.getX(i) * (0.8 + Math.random() * 0.4), pos.getY(i) * (0.7 + Math.random() * 0.4), pos.getZ(i) * (0.8 + Math.random() * 0.4));
    }
    geo.computeVertexNormals();
    const rock = new THREE.Mesh(geo, this.rockMaterial ?? new THREE.MeshStandardMaterial({ color: "#b59a78", roughness: 1 }));
    rock.position.y = 0.45;
    rock.scale.y = 0.8;
    rock.castShadow = true;
    rock.receiveShadow = true;
    g.add(rock);
    return g;
  }

  private makeBush(): THREE.Group {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: "#4f9a4a", roughness: 0.9 });
    for (let i = 0; i < 3; i += 1) {
      const blob = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 8), mat);
      blob.position.set((Math.random() - 0.5) * 0.4, 0.25 + Math.random() * 0.1, (Math.random() - 0.5) * 0.4);
      blob.castShadow = true;
      g.add(blob);
    }
    return g;
  }

  private setupRockMaterial(): void {
    const rock = new THREE.MeshStandardMaterial({ color: "#b59a78", roughness: 1 });
    this.rockMaterial = rock;
    void this.loadTextureAsset("rock_color.jpg", true).then((t) => {
      if (!t) return;
      t.wrapS = THREE.RepeatWrapping;
      t.wrapT = THREE.RepeatWrapping;
      rock.map = t;
      rock.color.set("#ffffff");
      rock.needsUpdate = true;
    });
    void this.loadTextureAsset("rock_normal.png", false).then((t) => {
      if (!t) return;
      t.wrapS = THREE.RepeatWrapping;
      t.wrapT = THREE.RepeatWrapping;
      rock.normalMap = t;
      rock.needsUpdate = true;
    });
  }

  private buildIsland(centre: THREE.Vector2[]): void {
    const scene = this.scene;
    if (!scene) return;
    let cx = 0;
    let cz = 0;
    for (const p of centre) {
      cx += p.x;
      cz += p.y;
    }
    cx /= centre.length;
    cz /= centre.length;
    const N = 128;
    const rad = new Array<number>(N).fill(0);
    for (const p of centre) {
      const dx = p.x - cx;
      const dz = p.y - cz;
      const ang = Math.atan2(dz, dx);
      const bin = ((Math.round((ang / (Math.PI * 2)) * N) % N) + N) % N;
      rad[bin] = Math.max(rad[bin], Math.hypot(dx, dz));
    }
    for (let i = 0; i < N; i += 1) if (rad[i] === 0) rad[i] = rad[(i - 1 + N) % N];
    for (let i = N - 1; i >= 0; i -= 1) if (rad[i] === 0) rad[i] = rad[(i + 1) % N];
    const margin = this.halfWidthScene + 6.5;
    for (let i = 0; i < N; i += 1) {
      const a = (i / N) * Math.PI * 2;
      const noise = 1 + 0.07 * Math.sin(3 * a + 1.1) + 0.05 * Math.sin(7 * a + 2.3) + 0.035 * Math.sin(13 * a + 0.5);
      rad[i] = (rad[i] + margin) * noise;
    }
    for (let pass = 0; pass < 2; pass += 1) {
      const cp = rad.slice();
      for (let i = 0; i < N; i += 1) rad[i] = (cp[(i - 1 + N) % N] + 2 * cp[i] + cp[(i + 1) % N]) / 4;
    }
    const islandShape = new THREE.Shape();
    const beachShape = new THREE.Shape();
    for (let i = 0; i < N; i += 1) {
      const a = (i / N) * Math.PI * 2;
      const X = cx + rad[i] * Math.cos(a);
      const Z = cz + rad[i] * Math.sin(a);
      const Xb = cx + (rad[i] + 2.8) * Math.cos(a);
      const Zb = cz + (rad[i] + 2.8) * Math.sin(a);
      if (i === 0) {
        islandShape.moveTo(X, -Z);
        beachShape.moveTo(Xb, -Zb);
      } else {
        islandShape.lineTo(X, -Z);
        beachShape.lineTo(Xb, -Zb);
      }
    }
    islandShape.closePath();
    beachShape.closePath();
    const islandMat = new THREE.MeshStandardMaterial({ map: makeSandTexture(), roughness: 1, metalness: 0 });
    const island = new THREE.Mesh(new THREE.ShapeGeometry(islandShape, 14), islandMat);
    island.rotation.x = -Math.PI / 2;
    island.position.y = 0;
    island.receiveShadow = true;
    scene.add(island);
    const beach = new THREE.Mesh(new THREE.ShapeGeometry(beachShape, 14), new THREE.MeshStandardMaterial({ color: "#e8d3a0", roughness: 1 }));
    beach.rotation.x = -Math.PI / 2;
    beach.position.y = -0.18;
    scene.add(beach);
    void this.loadTextureAsset("ground.jpg", true).then((t) => {
      if (!t) return;
      t.wrapS = THREE.RepeatWrapping;
      t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(0.12, 0.12);
      t.anisotropy = 4;
      islandMat.map = t;
      islandMat.color.set("#ffffff");
      islandMat.needsUpdate = true;
    });
  }

  private addInfieldProps(centre: THREE.Vector2[], halfWidth: number): void {
    const group = this.trackGroup;
    if (!group) return;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const p of centre) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.y);
      maxZ = Math.max(maxZ, p.y);
    }
    const m = centre.length;
    const inside = (x: number, z: number): boolean => {
      let c = false;
      for (let i = 0, j = m - 1; i < m; j = i++) {
        const ax = centre[i].x;
        const az = centre[i].y;
        const bx = centre[j].x;
        const bz = centre[j].y;
        if (az > z !== bz > z && x < ((bx - ax) * (z - az)) / (bz - az) + ax) c = !c;
      }
      return c;
    };
    const offRoad = (x: number, z: number): boolean => {
      let min = Infinity;
      for (const p of centre) {
        const d = Math.hypot(p.x - x, p.y - z);
        if (d < min) min = d;
      }
      return min > halfWidth + 2.2;
    };
    const palm = this.makePalm();
    const boulder = this.makeBoulder();
    const bush = this.makeBush();
    const treePositions: { x: number; z: number }[] = [];
    let placed = 0;
    let tries = 0;
    while (placed < 52 && tries < 900) {
      tries += 1;
      const x = minX + Math.random() * (maxX - minX);
      const z = minZ + Math.random() * (maxZ - minZ);
      if (!inside(x, z) || !offRoad(x, z)) continue;
      const r = Math.random();
      if (r < 0.32) {
        treePositions.push({ x, z });
        placed += 1;
        continue;
      }
      const proto = r < 0.56 ? palm : r < 0.8 ? boulder : bush;
      const inst = proto.clone(true);
      inst.position.set(x, 0, z);
      inst.rotation.y = Math.random() * Math.PI * 2;
      inst.scale.multiplyScalar(0.8 + Math.random() * 0.6);
      group.add(inst);
      placed += 1;
    }
    void this.getNatureTemplate("CommonTree_1", 3.6).then((tpl) => {
      if (!tpl || !this.trackGroup) return;
      for (const p of treePositions) {
        const inst = tpl.clone(true);
        inst.position.set(p.x, 0, p.z);
        inst.rotation.y = Math.random() * Math.PI * 2;
        inst.scale.multiplyScalar(0.85 + Math.random() * 0.4);
        this.trackGroup.add(inst);
      }
    });
  }

  private loadTextureAsset(name: string, srgb: boolean): Promise<THREE.Texture | null> {
    const injected = window.__driftRacerCarData?.textures?.[name];
    const url = injected ?? `${TEX_BASE}/${name}`;
    return new Promise((resolve) => {
      new THREE.TextureLoader().load(
        url,
        (tex) => {
          if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
          resolve(tex);
        },
        undefined,
        () => resolve(null)
      );
    });
  }

  private getNatureTemplate(name: string, targetHeight: number): Promise<THREE.Group | null> {
    const cached = this.natureTemplates.get(name);
    if (cached) return cached;
    const promise = this.loadNatureTemplate(name, targetHeight).catch(() => null);
    this.natureTemplates.set(name, promise);
    return promise;
  }

  private async loadNatureTemplate(name: string, targetHeight: number): Promise<THREE.Group | null> {
    const injected = window.__driftRacerCarData?.nature?.[name];
    const scene = await new Promise<THREE.Group | null>((resolve) => {
      const onLoad = (gltf: { scene: THREE.Group }) => resolve(gltf.scene);
      const onError = () => resolve(null);
      if (injected) this.gltfLoader.parse(injected, "", onLoad, onError);
      else this.gltfLoader.load(`${NATURE_BASE}/${name}.gltf`, onLoad, undefined, onError);
    });
    if (!scene) return null;
    const box = new THREE.Box3().setFromObject(scene);
    const size = new THREE.Vector3();
    box.getSize(size);
    const scale = targetHeight / (size.y || 1);
    scene.scale.setScalar(scale);
    const box2 = new THREE.Box3().setFromObject(scene);
    const ctr = new THREE.Vector3();
    box2.getCenter(ctr);
    scene.position.x -= ctr.x;
    scene.position.z -= ctr.z;
    scene.position.y -= box2.min.y;
    scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        const mat = mesh.material as THREE.MeshStandardMaterial;
        if (mat) {
          mat.metalness = 0;
          mat.needsUpdate = true;
        }
      }
    });
    const holder = new THREE.Group();
    holder.add(scene);
    return holder;
  }

  private scatterNature(centre: THREE.Vector2[], normals: THREE.Vector2[], halfWidth: number): void {
    if (!this.trackGroup) return;
    const specs = [
      { name: "CommonTree_1", height: 3.6, every: 9, phase: 0, out: 1.8 },
      { name: "CommonTree_3", height: 3.2, every: 9, phase: 4, out: 1.8 },
      { name: "Bush_Common", height: 1.0, every: 7, phase: 2, out: 1.2 },
      { name: "Grass_Common_Tall", height: 0.7, every: 5, phase: 1, out: 0.5 }
    ];
    const count = centre.length;
    for (const spec of specs) {
      const placements: { x: number; z: number; yaw: number }[] = [];
      for (let i = spec.phase; i < count; i += spec.every) {
        const side = i % 2 === 0 ? 1 : -1;
        const c = centre[i];
        const n = normals[i];
        const dist = halfWidth + spec.out + (i % 3) * 0.5;
        placements.push({ x: c.x + n.x * dist * side, z: c.y + n.y * dist * side, yaw: (i * 1.3) % (Math.PI * 2) });
      }
      void this.getNatureTemplate(spec.name, spec.height).then((tpl) => {
        if (!tpl || !this.trackGroup) return;
        for (const p of placements) {
          const inst = tpl.clone(true);
          inst.position.set(p.x, 0, p.z);
          inst.rotation.y = p.yaw;
          inst.scale.multiplyScalar(0.85 + Math.random() * 0.4);
          this.trackGroup.add(inst);
        }
      });
    }
  }

  // ---- car asset loading ----------------------------------------------

  private getColormap(): Promise<THREE.Texture | null> {
    if (this.colormapPromise) return this.colormapPromise;
    const injected = window.__driftRacerCarData?.colormap;
    const url = injected ?? `${ASSET_BASE}/colormap.png`;
    this.colormapPromise = new Promise<THREE.Texture | null>((resolve) => {
      new THREE.TextureLoader().load(
        url,
        (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.flipY = false;
          resolve(tex);
        },
        undefined,
        () => resolve(null)
      );
    });
    return this.colormapPromise;
  }

  private getCarTemplate(name: string): Promise<THREE.Group | null> {
    const cached = this.modelTemplates.get(name);
    if (cached) return cached;
    const promise = this.loadCarTemplate(name).catch(() => null);
    this.modelTemplates.set(name, promise);
    return promise;
  }

  private async loadCarTemplate(name: string): Promise<THREE.Group | null> {
    const injected = window.__driftRacerCarData?.models?.[name];
    const scene = await new Promise<THREE.Group | null>((resolve) => {
      const onLoad = (gltf: { scene: THREE.Group }) => resolve(gltf.scene);
      const onError = () => resolve(null);
      if (injected) {
        // injected is a base64 data URL of the .glb
        fetch(injected)
          .then((r) => r.arrayBuffer())
          .then((buf) => this.gltfLoader.parse(buf, "", onLoad, onError))
          .catch(onError);
      } else {
        this.gltfLoader.load(`${ASSET_BASE}/${name}.glb`, onLoad, undefined, onError);
      }
    });
    if (!scene) return null;
    const colormap = await this.getColormap();
    const box = new THREE.Box3().setFromObject(scene);
    const size = new THREE.Vector3();
    box.getSize(size);
    const length = Math.max(size.x, size.z) || 1;
    const scale = TARGET_CAR_LENGTH / length;
    scene.scale.setScalar(scale);
    const box2 = new THREE.Box3().setFromObject(scene);
    const ctr = new THREE.Vector3();
    box2.getCenter(ctr);
    scene.position.x -= ctr.x;
    scene.position.z -= ctr.z;
    scene.position.y -= box2.min.y;
    scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        const mat = mesh.material as THREE.MeshStandardMaterial;
        if (mat) {
          if (colormap) mat.map = colormap;
          mat.metalness = 0.2;
          mat.roughness = 0.65;
          mat.needsUpdate = true;
        }
      }
    });
    const holder = new THREE.Group();
    holder.rotation.y = CAR_MODEL_YAW;
    holder.add(scene);
    return holder;
  }

  private createCar(color: string, modelName: string): CarView {
    const group = new THREE.Group();
    const tilt = new THREE.Group();
    group.add(tilt);
    const proceduralBody = new THREE.Group();
    tilt.add(proceduralBody);
    const paint = parseColor(color);

    const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.26, 0.62), new THREE.MeshStandardMaterial({ color: paint, roughness: 0.45, metalness: 0.2 }));
    chassis.position.y = 0.24;
    chassis.castShadow = true;
    proceduralBody.add(chassis);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.22, 0.5), new THREE.MeshStandardMaterial({ color: "#dbeafe", roughness: 0.2, metalness: 0.3 }));
    cabin.position.set(0.02, 0.46, 0);
    cabin.castShadow = true;
    proceduralBody.add(cabin);

    const wheelGeo = new THREE.CylinderGeometry(0.19, 0.19, 0.14, 14);
    wheelGeo.rotateX(Math.PI / 2);
    const wheelMat = new THREE.MeshStandardMaterial({ color: "#0f172a", roughness: 0.85 });
    const wheels: THREE.Mesh[] = [];
    const frontPivots: THREE.Group[] = [];
    const offsets = [
      { x: 0.42, z: 0.34, front: true },
      { x: 0.42, z: -0.34, front: true },
      { x: -0.42, z: 0.34, front: false },
      { x: -0.42, z: -0.34, front: false }
    ];
    for (const off of offsets) {
      const wheel = new THREE.Mesh(wheelGeo, wheelMat);
      wheel.castShadow = true;
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

    // Player-colour identifier ring under the car.
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.78, 0.07, 8, 24),
      new THREE.MeshBasicMaterial({ color: paint, transparent: true, opacity: 0.9 })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.05;
    group.add(ring);

    const boostFlame = new THREE.Mesh(
      new THREE.ConeGeometry(0.16, 0.6, 12),
      new THREE.MeshBasicMaterial({ color: "#fb923c", transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    boostFlame.rotation.z = Math.PI / 2;
    boostFlame.position.set(-0.95, 0.24, 0);
    boostFlame.visible = false;
    group.add(boostFlame);

    const car: CarView = {
      group,
      tilt,
      proceduralBody,
      wheels,
      frontPivots,
      ring,
      boostFlame,
      modelLoaded: false,
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
      spunOut: false,
      prevSpunOut: false,
      wheelSpin: 0
    };

    void this.getCarTemplate(modelName).then((template) => {
      if (!template) return;
      const model = template.clone(true);
      tilt.add(model);
      proceduralBody.visible = false;
      for (const w of wheels) w.visible = false;
      car.modelLoaded = true;
    });

    return car;
  }

  private syncCars(state: DriftRacerState): void {
    const carGroup = this.carGroup;
    if (!carGroup) return;
    const seen = new Set<string>();
    let index = 0;
    for (const racer of state.racers) {
      seen.add(racer.playerId);
      let car = this.cars.get(racer.playerId);
      if (!car) {
        const modelName = CAR_MODELS[index % CAR_MODELS.length];
        car = this.createCar(racer.color, modelName);
        carGroup.add(car.group);
        car.x = this.sx(racer.x);
        car.z = this.sz(racer.y);
        car.angle = racer.angleRad;
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
      car.spunOut = racer.spunOut;
      index += 1;
    }
    for (const [playerId, car] of this.cars) {
      if (!seen.has(playerId)) {
        carGroup.remove(car.group);
        disposeObject(car.group);
        this.cars.delete(playerId);
      }
    }
  }

  // ---- pickups + projectiles ------------------------------------------

  private syncPickups(state: DriftRacerState): void {
    const group = this.fxGroup;
    if (!group) return;
    const seen = new Set<string>();
    for (const pickup of state.pickups) {
      seen.add(pickup.id);
      let mesh = this.pickupMeshes.get(pickup.id);
      if (!mesh) {
        mesh = new THREE.Mesh(
          new THREE.BoxGeometry(0.7, 0.7, 0.7),
          new THREE.MeshStandardMaterial({ map: this.itemBoxTexture, emissive: "#f59e0b", emissiveIntensity: 0.35, roughness: 0.4 })
        );
        mesh.castShadow = true;
        mesh.position.set(this.sx(pickup.x), 0.55, this.sz(pickup.y));
        group.add(mesh);
        this.pickupMeshes.set(pickup.id, mesh);
      }
      mesh.visible = pickup.active;
    }
    for (const [id, mesh] of this.pickupMeshes) {
      if (!seen.has(id)) {
        group.remove(mesh);
        disposeObject(mesh);
        this.pickupMeshes.delete(id);
      }
    }
  }

  private syncProjectiles(state: DriftRacerState): void {
    const group = this.fxGroup;
    if (!group) return;
    const seen = new Set<string>();
    for (const p of state.projectiles) {
      seen.add(p.id);
      let entry = this.projectileMeshes.get(p.id);
      if (!entry) {
        const obj = p.kind === "rocket" ? this.makeRocketMesh() : this.makeMineMesh();
        obj.position.set(this.sx(p.x), p.z * WORLD_SCALE + 0.1, this.sz(p.y));
        group.add(obj);
        entry = { obj, tx: this.sx(p.x), ty: p.z * WORLD_SCALE + 0.1, tz: this.sz(p.y) };
        this.projectileMeshes.set(p.id, entry);
      }
      entry.tx = this.sx(p.x);
      entry.ty = p.z * WORLD_SCALE + 0.1;
      entry.tz = this.sz(p.y);
      entry.obj.rotation.y = -p.angleRad;
    }
    for (const [id, entry] of this.projectileMeshes) {
      if (!seen.has(id)) {
        group.remove(entry.obj);
        disposeObject(entry.obj);
        this.projectileMeshes.delete(id);
      }
    }
  }

  private makeRocketMesh(): THREE.Object3D {
    const g = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.ConeGeometry(0.12, 0.5, 10),
      new THREE.MeshStandardMaterial({ color: "#e2e8f0", emissive: "#f97316", emissiveIntensity: 0.5, metalness: 0.4, roughness: 0.4 })
    );
    body.rotation.z = -Math.PI / 2;
    g.add(body);
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.1, 0.4, 8),
      new THREE.MeshBasicMaterial({ color: "#fb923c", transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    flame.rotation.z = Math.PI / 2;
    flame.position.x = -0.4;
    g.add(flame);
    return g;
  }

  private makeMineMesh(): THREE.Object3D {
    const g = new THREE.Group();
    const puck = new THREE.Mesh(
      new THREE.CylinderGeometry(0.26, 0.3, 0.16, 12),
      new THREE.MeshStandardMaterial({ color: "#1f2937", metalness: 0.5, roughness: 0.5 })
    );
    puck.castShadow = true;
    g.add(puck);
    const light = new THREE.Mesh(
      new THREE.SphereGeometry(0.07, 8, 8),
      new THREE.MeshBasicMaterial({ color: "#ef4444" })
    );
    light.position.y = 0.12;
    light.name = "mineLight";
    g.add(light);
    return g;
  }

  private spawnExplosion(x: number, y: number, z: number): void {
    if (this.explosionPool.length === 0) return;
    const entry = this.explosionPool[this.explosionCursor];
    this.explosionCursor = (this.explosionCursor + 1) % this.explosionPool.length;
    entry.active = true;
    entry.born = performance.now();
    entry.sprite.visible = true;
    entry.sprite.position.set(x, y + 0.5, z);
    entry.sprite.scale.setScalar(1.2);
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

      if (!car.modelLoaded) {
        const sceneSpeed = car.speed * WORLD_SCALE;
        car.wheelSpin -= (sceneSpeed / 0.19) * dt;
        for (const wheel of car.wheels) wheel.rotation.z = car.wheelSpin;
        const steerAngle = car.steer * 0.5;
        for (const pivot of car.frontPivots) pivot.rotation.y = steerAngle;
      }

      const roll = car.steer * (car.drifting ? 0.22 : 0.08);
      const pitch = clamp(car.vz * 0.0016, -0.5, 0.5);
      car.tilt.rotation.set(roll, 0, pitch);

      car.boostFlame.visible = car.boost;
      if (car.boost) car.boostFlame.scale.set(0.8 + Math.sin(now * 0.05) * 0.25, 1, 1);

      if (car.spunOut && !car.prevSpunOut) this.spawnExplosion(car.x, car.height, car.z);
      car.prevSpunOut = car.spunOut;

      if (car.drifting && !car.airborne && !car.finished) {
        const moved = Math.hypot(car.x - this.skidRef(car).x, car.z - this.skidRef(car).z);
        if (moved > SKID_MIN_STEP) {
          this.placeSkid(car, now);
          this._skidRef.set(car, { x: car.x, z: car.z });
        }
      }
    }

    // animate pickups
    for (const mesh of this.pickupMeshes.values()) {
      if (!mesh.visible) continue;
      mesh.rotation.y += dt * 1.6;
      mesh.position.y = 0.55 + Math.sin(now * 0.004 + mesh.position.x) * 0.12;
    }
    // smooth projectiles + blink mines
    for (const entry of this.projectileMeshes.values()) {
      entry.obj.position.x += (entry.tx - entry.obj.position.x) * 0.4;
      entry.obj.position.y += (entry.ty - entry.obj.position.y) * 0.4;
      entry.obj.position.z += (entry.tz - entry.obj.position.z) * 0.4;
      const light = entry.obj.getObjectByName("mineLight") as THREE.Mesh | null;
      if (light) (light.material as THREE.MeshBasicMaterial).opacity = 0.5 + 0.5 * Math.sin(now * 0.02);
    }

    if (this.waterMaterial && this.waterMaterial.normalMap) {
      this.waterMaterial.normalMap.offset.x += dt * 0.03;
      this.waterMaterial.normalMap.offset.y += dt * 0.02;
    }
    this.fadeSkids(now);
    this.updateExplosions(now);
    this.updateCamera(dt, now);
    renderer.render(scene, camera);
  }

  private _skidRef = new WeakMap<CarView, { x: number; z: number }>();
  private skidRef(car: CarView): { x: number; z: number } {
    let r = this._skidRef.get(car);
    if (!r) {
      r = { x: car.x, z: car.z };
      this._skidRef.set(car, r);
    }
    return r;
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
      entry.mesh.position.set(wx, 0.03, wz);
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

  private updateExplosions(now: number): void {
    for (const e of this.explosionPool) {
      if (!e.active) continue;
      const age = now - e.born;
      const life = 600;
      if (age >= life) {
        e.active = false;
        e.sprite.visible = false;
        continue;
      }
      const t = age / life;
      e.sprite.scale.setScalar(1.2 + t * 2.4);
      (e.sprite.material as THREE.SpriteMaterial).opacity = (1 - t) * 0.95;
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
    for (const racer of state.racers) if (racer.rank < leader.rank) leader = racer;
    return this.cars.get(leader.playerId) ?? null;
  }

  private updateCamera(dt: number, now: number): void {
    const camera = this.camera;
    if (!camera) return;
    const targetPos = new THREE.Vector3();
    const targetLook = new THREE.Vector3();
    let rate = 4;
    const leader = this.findLeader();

    if (this.cameraMode === "dynamic") {
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
      for (const c of cars) radius = Math.max(radius, Math.hypot(c.x - cx, c.z - cz) + 4);
      const halfV = (50 * Math.PI) / 180 / 2;
      const dist = clamp((radius / Math.tan(halfV)) * 1.12, 18, 80);
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
      const c = this.cameraCentroid();
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

  private cameraCentroid(): THREE.Vector3 {
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

  private ensureHudStructure(): { board: HTMLDivElement; info: HTMLDivElement; banner: HTMLDivElement; hint: HTMLDivElement } {
    const hud = this.hud!;
    let board = hud.querySelector<HTMLDivElement>("[data-board]");
    let info = hud.querySelector<HTMLDivElement>("[data-info]");
    let banner = hud.querySelector<HTMLDivElement>("[data-banner]");
    let hint = hud.querySelector<HTMLDivElement>("[data-hint]");
    if (!board) {
      board = document.createElement("div");
      board.dataset.board = "1";
      Object.assign(board.style, { position: "absolute", top: "18px", left: "18px", minWidth: "220px", padding: "12px 14px", borderRadius: "14px", background: "rgba(2,6,23,0.55)", backdropFilter: "blur(6px)", boxShadow: "0 6px 22px rgba(0,0,0,0.35)" } satisfies Partial<CSSStyleDeclaration>);
      hud.appendChild(board);
    }
    if (!info) {
      info = document.createElement("div");
      info.dataset.info = "1";
      Object.assign(info.style, { position: "absolute", top: "18px", right: "18px", textAlign: "right", padding: "12px 14px", borderRadius: "14px", background: "rgba(2,6,23,0.55)", backdropFilter: "blur(6px)", boxShadow: "0 6px 22px rgba(0,0,0,0.35)" } satisfies Partial<CSSStyleDeclaration>);
      hud.appendChild(info);
    }
    if (!banner) {
      banner = document.createElement("div");
      banner.dataset.banner = "1";
      Object.assign(banner.style, { position: "absolute", top: "26%", left: "0", right: "0", textAlign: "center", fontSize: "clamp(34px, 6vw, 76px)", fontWeight: "900", letterSpacing: "2px", textShadow: "0 4px 18px rgba(0,0,0,0.6)", display: "none" } satisfies Partial<CSSStyleDeclaration>);
      hud.appendChild(banner);
    }
    if (!hint) {
      hint = document.createElement("div");
      hint.dataset.hint = "1";
      Object.assign(hint.style, { position: "absolute", bottom: "16px", left: "18px", fontSize: "13px", opacity: "0.75", background: "rgba(2,6,23,0.4)", padding: "6px 10px", borderRadius: "10px" } satisfies Partial<CSSStyleDeclaration>);
      hud.appendChild(hint);
    }
    return { board, info, banner, hint };
  }

  private updateCameraLabel(): void {
    if (!this.hud) return;
    const { hint } = this.ensureHudStructure();
    const label = CAMERA_LABELS[this.cameraMode][this.en ? "en" : "de"];
    hint.textContent = (this.en ? "Camera (C): " : "Kamera (C): ") + label + (this.en ? "  ·  Fire = weapon" : "  ·  Fire = Waffe");
  }

  private updateHud(state: DriftRacerState): void {
    if (!this.hud) return;
    const { board, info, banner } = this.ensureHudStructure();
    const en = this.en;
    const ranked = [...state.racers].sort((a, b) => a.rank - b.rank);

    board.innerHTML = "";
    const title = document.createElement("div");
    title.textContent = en ? "Standings" : "Platzierung";
    Object.assign(title.style, { fontSize: "12px", letterSpacing: "1px", textTransform: "uppercase", opacity: "0.65", marginBottom: "8px" } satisfies Partial<CSSStyleDeclaration>);
    board.appendChild(title);

    ranked.forEach((racer, index) => {
      const row = document.createElement("div");
      Object.assign(row.style, { display: "flex", alignItems: "center", gap: "8px", padding: "3px 0", fontSize: "15px", fontWeight: "700", opacity: racer.finished ? "0.7" : "1" } satisfies Partial<CSSStyleDeclaration>);
      const pos = document.createElement("span");
      pos.textContent = String(index + 1);
      Object.assign(pos.style, { width: "16px", opacity: "0.7" } satisfies Partial<CSSStyleDeclaration>);
      const dot = document.createElement("span");
      Object.assign(dot.style, { width: "12px", height: "12px", borderRadius: "50%", background: racer.color, boxShadow: "0 0 8px " + racer.color } satisfies Partial<CSSStyleDeclaration>);
      const name = document.createElement("span");
      name.textContent = racer.name;
      Object.assign(name.style, { flex: "1", whiteSpace: "nowrap" } satisfies Partial<CSSStyleDeclaration>);
      const weapon = document.createElement("span");
      weapon.textContent = racer.weapon ? WEAPON_ICON[racer.weapon] ?? "" : "";
      weapon.style.width = "18px";
      const lap = document.createElement("span");
      const lapNum = Math.min(state.lapsToWin, racer.finished ? state.lapsToWin : racer.lap + 1);
      lap.textContent = lapNum + "/" + state.lapsToWin;
      Object.assign(lap.style, { opacity: "0.75", fontVariantNumeric: "tabular-nums" } satisfies Partial<CSSStyleDeclaration>);
      row.append(pos, dot, name, weapon, lap);
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
      banner.textContent = state.isTimedOut ? state.winnerName + " " + (en ? "leads!" : "führt!") : state.winnerName + " " + (en ? "wins!" : "gewinnt!");
    } else {
      banner.style.display = "none";
    }
    this.updateCameraLabel();
  }
}
