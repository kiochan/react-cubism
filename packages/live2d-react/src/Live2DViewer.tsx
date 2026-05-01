"use client";

import { useEffect, useRef, type MutableRefObject } from "react";
import type {} from "./live2dcubismcore-types";

export interface Live2DViewerProps {
  /** URL to the .model3.json settings file */
  modelUrl: string;
  width?: number;
  height?: number;
  parameterValues?: Record<string, number>;
  parameterValuesRef?: MutableRefObject<Record<string, number>>;
  motionRequest?: Live2DMotionRequest | null;
  expressionRequest?: Live2DExpressionRequest | null;
  onParametersLoaded?: (parameters: Live2DParameter[]) => void;
  onParameterValuesChanged?: (values: Record<string, number>) => void;
  onMotionsLoaded?: (motions: Live2DMotionOption[]) => void;
  onExpressionsLoaded?: (expressions: Live2DExpressionOption[]) => void;
}

export interface Live2DParameter {
  id: string;
  minimumValue: number;
  maximumValue: number;
  defaultValue: number;
  value: number;
}

export interface Live2DMotionOption {
  group: string;
  index: number;
  name: string;
}

export interface Live2DMotionRequest {
  group: string;
  index: number;
  nonce: number;
}

export interface Live2DExpressionOption {
  index: number;
  name: string;
}

export interface Live2DExpressionRequest {
  index: number;
  nonce: number;
}

const CUBISM_CORE_SCRIPT_SRC = "/live2dcubism/Core/live2dcubismcore.min.js";
const CUBISM_SHADER_DIR = "/live2dcubism/Framework/Shaders/WebGL/";
const scriptPromises = new Map<string, Promise<void>>();
let frameworkStarted = false;

interface ModelSettings {
  FileReferences?: {
    Moc?: string;
    Textures?: string[];
    Physics?: string;
    Pose?: string;
    Expressions?: Array<{
      Name?: string;
      File?: string;
    }>;
    Motions?: Record<
      string,
      Array<{
        File?: string;
        FadeInTime?: number;
        FadeOutTime?: number;
      }>
    >;
  };
  Groups?: Array<{
    Target?: string;
    Name?: string;
    Ids?: string[];
  }>;
  Layout?: Record<string, number>;
}

interface FrameworkModules {
  CubismFramework: typeof import("./vendor/cubism-framework/live2dcubismframework").CubismFramework;
  CubismBreath: typeof import("./vendor/cubism-framework/effect/cubismbreath").CubismBreath;
  CubismEyeBlink: typeof import("./vendor/cubism-framework/effect/cubismeyeblink").CubismEyeBlink;
  CubismMatrix44: typeof import("./vendor/cubism-framework/math/cubismmatrix44").CubismMatrix44;
  CubismModelMatrix: typeof import("./vendor/cubism-framework/math/cubismmodelmatrix").CubismModelMatrix;
  CubismMoc: typeof import("./vendor/cubism-framework/model/cubismmoc").CubismMoc;
  CubismMotion: typeof import("./vendor/cubism-framework/motion/cubismmotion").CubismMotion;
  CubismMotionManager: typeof import("./vendor/cubism-framework/motion/cubismmotionmanager").CubismMotionManager;
  CubismExpressionMotion: typeof import("./vendor/cubism-framework/motion/cubismexpressionmotion").CubismExpressionMotion;
  CubismExpressionMotionManager: typeof import("./vendor/cubism-framework/motion/cubismexpressionmotionmanager").CubismExpressionMotionManager;
  CubismPhysics: typeof import("./vendor/cubism-framework/physics/cubismphysics").CubismPhysics;
  CubismPose: typeof import("./vendor/cubism-framework/effect/cubismpose").CubismPose;
  CubismRenderer_WebGL: typeof import("./vendor/cubism-framework/rendering/cubismrenderer_webgl").CubismRenderer_WebGL;
  BreathParameterData: typeof import("./vendor/cubism-framework/effect/cubismbreath").BreathParameterData;
  CubismDefaultParameterId: typeof import("./vendor/cubism-framework/cubismdefaultparameterid").CubismDefaultParameterId;
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
    breathModule,
    eyeBlinkModule,
    matrixModule,
    modelMatrixModule,
    mocModule,
    motionModule,
    motionManagerModule,
    expressionMotionModule,
    expressionMotionManagerModule,
    physicsModule,
    poseModule,
    rendererModule,
    defaultParameterIdModule,
  ] = await Promise.all([
    import("./vendor/cubism-framework/live2dcubismframework"),
    import("./vendor/cubism-framework/effect/cubismbreath"),
    import("./vendor/cubism-framework/effect/cubismeyeblink"),
    import("./vendor/cubism-framework/math/cubismmatrix44"),
    import("./vendor/cubism-framework/math/cubismmodelmatrix"),
    import("./vendor/cubism-framework/model/cubismmoc"),
    import("./vendor/cubism-framework/motion/cubismmotion"),
    import("./vendor/cubism-framework/motion/cubismmotionmanager"),
    import("./vendor/cubism-framework/motion/cubismexpressionmotion"),
    import("./vendor/cubism-framework/motion/cubismexpressionmotionmanager"),
    import("./vendor/cubism-framework/physics/cubismphysics"),
    import("./vendor/cubism-framework/effect/cubismpose"),
    import("./vendor/cubism-framework/rendering/cubismrenderer_webgl"),
    import("./vendor/cubism-framework/cubismdefaultparameterid"),
  ]);

  return {
    CubismFramework: frameworkModule.CubismFramework,
    CubismBreath: breathModule.CubismBreath,
    CubismEyeBlink: eyeBlinkModule.CubismEyeBlink,
    CubismMatrix44: matrixModule.CubismMatrix44,
    CubismModelMatrix: modelMatrixModule.CubismModelMatrix,
    CubismMoc: mocModule.CubismMoc,
    CubismMotion: motionModule.CubismMotion,
    CubismMotionManager: motionManagerModule.CubismMotionManager,
    CubismExpressionMotion: expressionMotionModule.CubismExpressionMotion,
    CubismExpressionMotionManager:
      expressionMotionManagerModule.CubismExpressionMotionManager,
    CubismPhysics: physicsModule.CubismPhysics,
    CubismPose: poseModule.CubismPose,
    CubismRenderer_WebGL: rendererModule.CubismRenderer_WebGL,
    BreathParameterData: breathModule.BreathParameterData,
    CubismDefaultParameterId: defaultParameterIdModule.CubismDefaultParameterId,
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

async function loadArrayBuffer(src: string): Promise<ArrayBuffer> {
  const res = await fetch(src);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${src}`);
  return res.arrayBuffer();
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

function getLive2DParameters(model: {
  getModel: () => Live2DCubismCore.Model;
}): Live2DParameter[] {
  const parameters = model.getModel().parameters;

  return Array.from({ length: parameters.count }, (_, index) => ({
    id: parameters.ids[index],
    minimumValue: parameters.minimumValues[index],
    maximumValue: parameters.maximumValues[index],
    defaultValue: parameters.defaultValues[index],
    value: parameters.values[index],
  }));
}

function resolveResource(base: string, path?: string) {
  return path ? base + path : null;
}

function getParameterIdsByGroup(
  settings: ModelSettings,
  groupName: string
): string[] {
  return (
    settings.Groups?.find(
      (group) => group.Target === "Parameter" && group.Name === groupName
    )?.Ids ?? []
  );
}

function hasParameterId(
  model: { getModel: () => Live2DCubismCore.Model },
  parameterId: string
) {
  return model.getModel().parameters.ids.includes(parameterId);
}

function createBreath(
  modules: FrameworkModules,
  model: { getModel: () => Live2DCubismCore.Model }
) {
  const {
    BreathParameterData,
    CubismBreath,
    CubismDefaultParameterId,
    CubismFramework,
  } = modules;
  const candidates: Array<[string, number, number, number, number]> = [
    [CubismDefaultParameterId.ParamAngleX, 0.0, 15.0, 6.5345, 0.5],
    [CubismDefaultParameterId.ParamAngleY, 0.0, 8.0, 3.5345, 0.5],
    [CubismDefaultParameterId.ParamAngleZ, 0.0, 10.0, 5.5345, 0.5],
    [CubismDefaultParameterId.ParamBodyAngleX, 0.0, 4.0, 15.5345, 0.5],
    [CubismDefaultParameterId.ParamBreath, 0.5, 0.5, 3.2345, 1.0],
  ];
  const breathParameters = candidates
    .filter(([id]) => hasParameterId(model, id))
    .map(
      ([id, offset, peak, cycle, weight]) =>
        new BreathParameterData(
          CubismFramework.getIdManager().getId(id),
          offset,
          peak,
          cycle,
          weight
        )
    );

  if (breathParameters.length === 0) return null;

  const breath = CubismBreath.create();
  breath.setParameters(breathParameters);
  return breath;
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
  parameterValues = {},
  parameterValuesRef: externalParameterValuesRef,
  motionRequest,
  expressionRequest,
  onParametersLoaded,
  onParameterValuesChanged,
  onMotionsLoaded,
  onExpressionsLoaded,
}: Live2DViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const internalParameterValuesRef = useRef(parameterValues);
  const parameterValuesRef =
    externalParameterValuesRef ?? internalParameterValuesRef;
  const onParametersLoadedRef = useRef(onParametersLoaded);
  const onParameterValuesChangedRef = useRef(onParameterValuesChanged);
  const onMotionsLoadedRef = useRef(onMotionsLoaded);
  const onExpressionsLoadedRef = useRef(onExpressionsLoaded);
  const motionRequestRef = useRef(motionRequest);
  const expressionRequestRef = useRef(expressionRequest);

  useEffect(() => {
    internalParameterValuesRef.current = parameterValues;
  }, [internalParameterValuesRef, parameterValues]);

  useEffect(() => {
    onParametersLoadedRef.current = onParametersLoaded;
  }, [onParametersLoaded]);

  useEffect(() => {
    onParameterValuesChangedRef.current = onParameterValuesChanged;
  }, [onParameterValuesChanged]);

  useEffect(() => {
    onMotionsLoadedRef.current = onMotionsLoaded;
  }, [onMotionsLoaded]);

  useEffect(() => {
    onExpressionsLoadedRef.current = onExpressionsLoaded;
  }, [onExpressionsLoaded]);

  useEffect(() => {
    motionRequestRef.current = motionRequest;
  }, [motionRequest]);

  useEffect(() => {
    expressionRequestRef.current = expressionRequest;
  }, [expressionRequest]);

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
    let motionManager: any = null;
    let expressionManager: any = null;
    let physics: any = null;
    let pose: any = null;
    let eyeBlink: any = null;
    let breath: any = null;
    let lastFrameTime = performance.now();
    let lastParameterReportTime = 0;
    let lastMotionNonce = motionRequestRef.current?.nonce ?? 0;
    let lastExpressionNonce = expressionRequestRef.current?.nonce ?? 0;
    let idleRestartPending = false;
    let motionEyeBlinkIds: any[] = [];
    let motionLipSyncIds: any[] = [];
    const parameterIndices = new Map<string, number>();
    const motionDefinitions = new Map<
      string,
      { group: string; index: number; url: string; fadeInTime?: number; fadeOutTime?: number }
    >();
    const expressionDefinitions: Array<{ name: string; url: string }> = [];

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

      const modules = await loadFrameworkModules();
      const {
        CubismFramework,
        CubismEyeBlink,
        CubismMatrix44,
        CubismModelMatrix,
        CubismMoc,
        CubismMotion,
        CubismMotionManager,
        CubismExpressionMotion,
        CubismExpressionMotionManager,
        CubismPhysics,
        CubismPose,
        CubismRenderer_WebGL,
      } = modules;
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
      getLive2DParameters(cubismModel).forEach((parameter, index) => {
        parameterIndices.set(parameter.id, index);
      });
      onParametersLoadedRef.current?.(getLive2DParameters(cubismModel));
      motionManager = new CubismMotionManager();
      expressionManager = new CubismExpressionMotionManager();
      breath = createBreath(modules, cubismModel);

      const eyeBlinkIds = getParameterIdsByGroup(settings, "EyeBlink").filter(
        (id) => hasParameterId(cubismModel, id)
      );
      motionEyeBlinkIds = eyeBlinkIds.map((id) =>
        CubismFramework.getIdManager().getId(id)
      );
      motionLipSyncIds = getParameterIdsByGroup(settings, "LipSync")
        .filter((id) => hasParameterId(cubismModel, id))
        .map((id) => CubismFramework.getIdManager().getId(id));
      if (eyeBlinkIds.length > 0) {
        eyeBlink = CubismEyeBlink.create();
        eyeBlink.setParameterIds(motionEyeBlinkIds);
      }

      for (const [group, motions] of Object.entries(
        settings.FileReferences?.Motions ?? {}
      )) {
        motions.forEach((motion, index) => {
          const url = resolveResource(base, motion.File);
          if (!url) return;

          motionDefinitions.set(`${group}:${index}`, {
            group,
            index,
            url,
            fadeInTime: motion.FadeInTime,
            fadeOutTime: motion.FadeOutTime,
          });
        });
      }
      onMotionsLoadedRef.current?.(
        Array.from(motionDefinitions.values()).map((motion) => ({
          group: motion.group,
          index: motion.index,
          name: `${motion.group} ${motion.index + 1}`,
        }))
      );

      (settings.FileReferences?.Expressions ?? []).forEach(
        (expression, index) => {
          const url = resolveResource(base, expression.File);
          if (!url) return;

          expressionDefinitions[index] = {
            name: expression.Name ?? `Expression ${index + 1}`,
            url,
          };
        }
      );
      onExpressionsLoadedRef.current?.(
        expressionDefinitions.map((expression, index) => ({
          index,
          name: expression.name,
        }))
      );

      const physicsUrl = resolveResource(base, settings.FileReferences?.Physics);
      if (physicsUrl) {
        try {
          const buffer = await loadArrayBuffer(physicsUrl);
          physics = CubismPhysics.create(buffer, buffer.byteLength);
        } catch (e) {
          console.error("[Live2DViewer] Failed to load physics:", e);
        }
      }

      const poseUrl = resolveResource(base, settings.FileReferences?.Pose);
      if (poseUrl) {
        try {
          const buffer = await loadArrayBuffer(poseUrl);
          pose = CubismPose.create(buffer, buffer.byteLength);
        } catch (e) {
          console.error("[Live2DViewer] Failed to load pose:", e);
        }
      }

      async function startMotion(group: string, index: number, loop: boolean) {
        const definition = motionDefinitions.get(`${group}:${index}`);
        if (!definition || !motionManager) return;

        try {
          const buffer = await loadArrayBuffer(definition.url);
          const motion = CubismMotion.create(buffer, buffer.byteLength);
          motion.setEffectIds(motionEyeBlinkIds, motionLipSyncIds);
          motion.setLoop(loop);
          if (definition.fadeInTime !== undefined) {
            motion.setFadeInTime(definition.fadeInTime);
          }
          if (definition.fadeOutTime !== undefined) {
            motion.setFadeOutTime(definition.fadeOutTime);
          }
          motionManager.startMotionPriority(motion, true, loop ? 1 : 3);
        } catch (e) {
          console.error("[Live2DViewer] Failed to start motion:", e);
        } finally {
          if (loop) {
            idleRestartPending = false;
          }
        }
      }

      async function startExpression(index: number) {
        const definition = expressionDefinitions[index];
        if (!definition || !expressionManager) return;

        try {
          const buffer = await loadArrayBuffer(definition.url);
          const expression = CubismExpressionMotion.create(
            buffer,
            buffer.byteLength
          );
          expressionManager.startMotion(expression, true);
        } catch (e) {
          console.error("[Live2DViewer] Failed to start expression:", e);
        }
      }

      const idleMotion = Array.from(motionDefinitions.values()).find((motion) =>
        motion.group.toLowerCase().includes("idle")
      );
      if (idleMotion) {
        await startMotion(idleMotion.group, idleMotion.index, true);
      }
      cubismModel.saveParameters();

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
        const now = performance.now();
        const deltaTimeSeconds = Math.min((now - lastFrameTime) / 1000, 0.1);
        lastFrameTime = now;

        const requestedMotion = motionRequestRef.current;
        if (requestedMotion && requestedMotion.nonce !== lastMotionNonce) {
          lastMotionNonce = requestedMotion.nonce;
          void startMotion(requestedMotion.group, requestedMotion.index, false);
        }
        const requestedExpression = expressionRequestRef.current;
        if (
          requestedExpression &&
          requestedExpression.nonce !== lastExpressionNonce
        ) {
          lastExpressionNonce = requestedExpression.nonce;
          void startExpression(requestedExpression.index);
        }

        cubismModel.loadParameters();
        motionManager?.updateMotion(cubismModel, deltaTimeSeconds);
        if (idleMotion && motionManager?.isFinished() && !idleRestartPending) {
          idleRestartPending = true;
          void startMotion(idleMotion.group, idleMotion.index, true);
        }
        cubismModel.saveParameters();
        eyeBlink?.updateParameters(cubismModel, deltaTimeSeconds);
        expressionManager?.updateMotion(cubismModel, deltaTimeSeconds);
        breath?.updateParameters(cubismModel, deltaTimeSeconds);
        physics?.evaluate(cubismModel, deltaTimeSeconds);
        pose?.updateParameters(cubismModel, deltaTimeSeconds);
        Object.entries(parameterValuesRef.current).forEach(([id, value]) => {
          const index = parameterIndices.get(id);
          if (index === undefined) return;

          cubismModel.setParameterValueByIndex(index, value, 1);
        });
        if (now - lastParameterReportTime > 100) {
          lastParameterReportTime = now;
          onParameterValuesChangedRef.current?.(
            Object.fromEntries(
              getLive2DParameters(cubismModel).map((parameter) => [
                parameter.id,
                parameter.value,
              ])
            )
          );
        }

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
      motionManager?.release();
      expressionManager?.release();
      physics?.release?.();
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
