"use client";

import { useEffect, useRef } from "react";
import type {} from "./live2dcubismcore-types";

export interface Live2DViewerProps {
  /** URL to the .model3.json settings file */
  modelUrl: string;
  width?: number;
  height?: number;
}

const CUBISM_CORE_SCRIPT_SRC = "/live2dcubism/Core/live2dcubismcore.min.js";
const CUBISM_SHADER_DIR = "/live2dcubism/Framework/Shaders/WebGL/";
const scriptPromises = new Map<string, Promise<void>>();
let frameworkStarted = false;

interface ModelSettings {
  FileReferences?: {
    Moc?: string;
    Textures?: string[];
  };
  Layout?: Record<string, number>;
}

interface FrameworkModules {
  CubismFramework: typeof import("./vendor/cubism-framework/live2dcubismframework").CubismFramework;
  CubismMatrix44: typeof import("./vendor/cubism-framework/math/cubismmatrix44").CubismMatrix44;
  CubismModelMatrix: typeof import("./vendor/cubism-framework/math/cubismmodelmatrix").CubismModelMatrix;
  CubismMoc: typeof import("./vendor/cubism-framework/model/cubismmoc").CubismMoc;
  CubismRenderer_WebGL: typeof import("./vendor/cubism-framework/rendering/cubismrenderer_webgl").CubismRenderer_WebGL;
}

/** Dynamically inserts a <script> tag and waits for it to finish loading. */
function loadScript(src: string): Promise<void> {
  if (src === CUBISM_CORE_SCRIPT_SRC && (window as any).Live2DCubismCore) {
    return Promise.resolve();
  }

  const existingPromise = scriptPromises.get(src);
  if (existingPromise) return existingPromise;

  const promise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${src}"]`
    );
    if (existing?.dataset.loaded === "true") {
      resolve();
      return;
    }

    const el = existing ?? document.createElement("script");
    el.src = src;
    el.async = true;
    el.onload = () => {
      el.dataset.loaded = "true";
      resolve();
    };
    el.onerror = () => {
      scriptPromises.delete(src);
      reject(new Error(`Cannot load script: ${src}`));
    };

    if (!existing) document.head.appendChild(el);
  }).then(() => undefined);

  scriptPromises.set(src, promise);
  return promise;
}

async function loadFrameworkModules(): Promise<FrameworkModules> {
  const [
    frameworkModule,
    matrixModule,
    modelMatrixModule,
    mocModule,
    rendererModule,
  ] = await Promise.all([
    import("./vendor/cubism-framework/live2dcubismframework"),
    import("./vendor/cubism-framework/math/cubismmatrix44"),
    import("./vendor/cubism-framework/math/cubismmodelmatrix"),
    import("./vendor/cubism-framework/model/cubismmoc"),
    import("./vendor/cubism-framework/rendering/cubismrenderer_webgl"),
  ]);

  return {
    CubismFramework: frameworkModule.CubismFramework,
    CubismMatrix44: matrixModule.CubismMatrix44,
    CubismModelMatrix: modelMatrixModule.CubismModelMatrix,
    CubismMoc: mocModule.CubismMoc,
    CubismRenderer_WebGL: rendererModule.CubismRenderer_WebGL,
  };
}

function ensureFrameworkStarted(
  CubismFramework: FrameworkModules["CubismFramework"]
) {
  if (frameworkStarted) return;

  CubismFramework.startUp();
  CubismFramework.initialize();
  frameworkStarted = true;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Cannot load image: ${src}`));
    image.src = src;
  });
}

function createTexture(
  gl: WebGLRenderingContext,
  image: HTMLImageElement
): WebGLTexture {
  const texture = gl.createTexture();
  if (!texture) throw new Error("Unable to create WebGL texture.");

  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    image
  );

  return texture;
}

function createMvpMatrix(
  CubismMatrix44: FrameworkModules["CubismMatrix44"],
  CubismModelMatrix: FrameworkModules["CubismModelMatrix"],
  model: { getCanvasWidth: () => number; getCanvasHeight: () => number },
  canvas: HTMLCanvasElement,
  layout?: Record<string, number>
) {
  const modelMatrix = new CubismModelMatrix(
    model.getCanvasWidth(),
    model.getCanvasHeight()
  );
  const projection = new CubismMatrix44();

  if (layout && Object.keys(layout).length > 0) {
    modelMatrix.setupFromLayout(new Map(Object.entries(layout)));
  } else if (model.getCanvasWidth() > 1.0 && canvas.width < canvas.height) {
    modelMatrix.setWidth(2.0);
    projection.scale(1.0, canvas.width / canvas.height);
  } else {
    projection.scale(canvas.height / canvas.width, 1.0);
  }

  projection.multiplyByMatrix(modelMatrix);
  return projection;
}

/**
 * Renders a Live2D Cubism 5 model on a WebGL canvas.
 *
 * Prerequisites (see README for details):
 *  1. Copy the Cubism 5 SDK into `apps/demo/public/live2dcubism/`, or copy
 *     `Core/live2dcubismcore.min.js` to that same `Core/` directory.
 *  2. Place model files under `apps/demo/public/models/`.
 */
export function Live2DViewer({
  modelUrl,
  width = 400,
  height = 600,
}: Live2DViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let rafId = 0;
    let stopped = false;
    let cubismMoc: { createModel: () => any; deleteModel: (model: any) => void; release: () => void } | null = null;
    let cubismModel: any = null;
    let glContext: WebGL2RenderingContext | null = null;
    let renderer: { initialize: (model: any) => void; startUp: (gl: WebGL2RenderingContext) => void; setIsPremultipliedAlpha: (enabled: boolean) => void; setMvpMatrix: (matrix: any) => void; bindTexture: (index: number, texture: WebGLTexture) => void; drawModel: (shaderPath?: string) => void; release: () => void } | null = null;
    let textures: WebGLTexture[] = [];

    (async () => {
      try {
        await loadScript(CUBISM_CORE_SCRIPT_SRC);
      } catch {
        console.error(
          "[Live2DViewer] Cubism 5 core not found.\n" +
            "Copy live2dcubismcore.min.js to public/live2dcubism/Core/.\n" +
            "See README.md for instructions."
        );
        return;
      }
      if (stopped) return;

      if (!(window as any).Live2DCubismCore) {
        console.error(
          "[Live2DViewer] Live2DCubismCore global not found after loading " +
            `${CUBISM_CORE_SCRIPT_SRC}.`
        );
        return;
      }

      const {
        CubismFramework,
        CubismMatrix44,
        CubismModelMatrix,
        CubismMoc,
        CubismRenderer_WebGL,
      } = await loadFrameworkModules();
      ensureFrameworkStarted(CubismFramework);
      if (stopped) return;

      const base = modelUrl.slice(0, modelUrl.lastIndexOf("/") + 1);
      let settings: ModelSettings;
      try {
        const res = await fetch(modelUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${modelUrl}`);
        settings = (await res.json()) as ModelSettings;
      } catch (e) {
        console.error("[Live2DViewer] Failed to load model settings:", e);
        return;
      }
      if (stopped) return;

      const mocPath = settings.FileReferences?.Moc;
      if (!mocPath) {
        console.error("[Live2DViewer] Model settings is missing the Moc path.");
        return;
      }

      try {
        const res = await fetch(base + mocPath);
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${mocPath}`);
        const mocBuffer = await res.arrayBuffer();
        cubismMoc = CubismMoc.create(mocBuffer, true);
        cubismModel = cubismMoc?.createModel() ?? null;
      } catch (e) {
        console.error("[Live2DViewer] Failed to create Cubism model:", e);
        return;
      }
      if (stopped || !cubismMoc || !cubismModel) return;

      const gl = canvas.getContext("webgl2", {
        premultipliedAlpha: true,
        alpha: true,
      });
      if (!gl) {
        console.error(
          "[Live2DViewer] WebGL2 is required by CubismRenderer_WebGL."
        );
        return;
      }
      const canvasElement = canvas;
      glContext = gl;

      try {
        const images = await Promise.all(
          (settings.FileReferences?.Textures ?? []).map((texturePath) =>
            loadImage(base + texturePath)
          )
        );
        textures = images.map((image) => createTexture(glContext!, image));
      } catch (e) {
        console.error("[Live2DViewer] Failed to load model textures:", e);
        return;
      }
      if (stopped) return;

      renderer = new CubismRenderer_WebGL(canvas.width, canvas.height);
      renderer.initialize(cubismModel);
      renderer.startUp(glContext);
      renderer.setIsPremultipliedAlpha(true);
      renderer.setMvpMatrix(
        createMvpMatrix(
          CubismMatrix44,
          CubismModelMatrix,
          cubismModel,
          canvasElement,
          settings.Layout
        )
      );
      textures.forEach((texture, index) => renderer?.bindTexture(index, texture));

      function tick() {
        if (stopped || !cubismModel || !renderer) return;

        glContext.viewport(0, 0, canvasElement.width, canvasElement.height);
        glContext.clearColor(0, 0, 0, 0);
        glContext.clear(glContext.COLOR_BUFFER_BIT);
        cubismModel.update();
        renderer.setMvpMatrix(
          createMvpMatrix(
            CubismMatrix44,
            CubismModelMatrix,
            cubismModel,
            canvasElement,
            settings.Layout
          )
        );
        renderer.drawModel(CUBISM_SHADER_DIR);
        rafId = requestAnimationFrame(tick);
      }
      rafId = requestAnimationFrame(tick);
    })().catch((err) => {
      if (!stopped) console.error("[Live2DViewer] Unexpected error:", err);
    });

    return () => {
      stopped = true;
      cancelAnimationFrame(rafId);
      renderer?.release();
      textures.forEach((texture) => {
        glContext?.deleteTexture(texture);
      });
      if (cubismMoc && cubismModel) cubismMoc.deleteModel(cubismModel);
      cubismMoc?.release();
    };
  }, [modelUrl]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{ display: "block" }}
    />
  );
}
