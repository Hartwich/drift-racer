declare module "three/addons/loaders/GLTFLoader.js" {
  import type { Group, LoadingManager } from "three";
  export interface GLTF {
    scene: Group;
    scenes: Group[];
  }
  export class GLTFLoader {
    constructor(manager?: LoadingManager);
    setPath(path: string): this;
    setResourcePath(path: string): this;
    load(
      url: string,
      onLoad: (gltf: GLTF) => void,
      onProgress?: (event: ProgressEvent) => void,
      onError?: (event: unknown) => void
    ): void;
    parse(
      data: ArrayBuffer | string,
      path: string,
      onLoad: (gltf: GLTF) => void,
      onError?: (event: unknown) => void
    ): void;
  }
}
