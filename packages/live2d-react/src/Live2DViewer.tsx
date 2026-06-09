"use client";

import {
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
  type PointerEvent,
  type WheelEvent,
} from "react";
import type {} from "./live2dcubismcore-types";

export interface Live2DViewerProps {
  /** URL to the .model3.json settings file */
  modelUrl: string;
  width?: number;
  height?: number;
  fitToContainer?: boolean;
  viewTransform?: Live2DViewTransform;
  viewTransformRef?: MutableRefObject<Live2DViewTransform>;
  parameterValues?: Record<string, number>;
  parameterValuesRef?: MutableRefObject<Record<string, number>>;
  motionRequest?: Live2DMotionRequest | null;
  expressionRequest?: Live2DExpressionRequest | null;
  effectSettings?: Live2DEffectSettings;
  parameterUpdateFps?: number;
  onParametersLoaded?: (parameters: Live2DParameter[]) => void;
  onParameterValuesChanged?: (values: Record<string, number>) => void;
  onViewTransformChanged?: (transform: Live2DViewTransform) => void;
  onModelDiagnostics?: (diagnostics: Live2DModelDiagnostics) => void;
  onMotionsLoaded?: (motions: Live2DMotionOption[]) => void;
  onExpressionsLoaded?: (expressions: Live2DExpressionOption[]) => void;
  transparentCanvas?: boolean;
  backgroundColor?: Live2DBackgroundColor;
}

export type Live2DBlendMode = "normal" | "multiply";

export interface Live2DModelLayerProps extends Live2DViewerProps {
  visible?: boolean;
  interactive?: boolean;
  blendMode?: Live2DBlendMode;
  clipToModelUrl?: string | null;
}

export interface Live2DMultiViewerProps {
  models: Live2DModelLayerProps[];
  width?: number;
  height?: number;
  fitToContainer?: boolean;
  selectedModelUrl?: string;
  transparentCanvas?: boolean;
  backgroundColor?: Live2DBackgroundColor;
}

export interface Live2DEffectSettings {
  idle?: boolean;
  eyeBlink?: boolean;
  breath?: boolean;
  physics?: boolean;
  pose?: boolean;
}

export interface Live2DViewTransform {
  panX: number;
  panY: number;
  zoom: number;
}

export type Live2DBackgroundColor = [number, number, number, number];

export interface Live2DModelDiagnostics {
  drawableCount: number;
  clippingDrawableCount: number;
  maskSourceCount: number;
  maskPermutationCount: number;
  hiddenMaskSourceIds: string[];
  exceedsWebMaskLimit: boolean;
  maskBufferCount: number;
  clippingMaskBufferSize: number;
  usesBlendMode: boolean;
  usesOffscreenMasking: boolean;
}

export interface Live2DParameter {
  id: string;
  name?: string;
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
const ignoreMotionEvent = () => undefined;
const DEFAULT_BACKGROUND_COLOR: Live2DBackgroundColor = [0, 0, 0, 0];
const DEFAULT_EFFECT_SETTINGS: Required<Live2DEffectSettings> = {
  idle: false,
  eyeBlink: false,
  breath: false,
  physics: false,
  pose: false,
};
let vertexPositionsDidChangeBit: number | null = null;

type CubismWebGLRendererLike = {
  initialize: (model: any, maskBufferCount?: number) => void;
  startUp: (gl: WebGL2RenderingContext) => void;
  setClippingMaskBufferSize?: (size: number) => void;
  setIsPremultipliedAlpha: (enabled: boolean) => void;
  setMvpMatrix: (matrix: any) => void;
  setRenderState: (fbo: WebGLFramebuffer | null, viewport: number[]) => void;
  bindTexture: (index: number, texture: WebGLTexture) => void;
  drawModel: (shaderPath?: string) => void;
  release: () => void;
};

interface ModelSettings {
  FileReferences?: {
    Moc?: string;
    Textures?: string[];
    Physics?: string;
    Pose?: string;
    DisplayInfo?: string;
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

interface DisplayInfo {
  Parameters?: Array<{
    Id?: string;
    Name?: string;
  }>;
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

function createLayerRenderTarget(
  gl: WebGL2RenderingContext,
  width: number,
  height: number
) {
  const texture = gl.createTexture();
  const framebuffer = gl.createFramebuffer();

  if (!texture || !framebuffer) {
    throw new Error("Unable to create layer render target.");
  }

  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    width,
    height,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    null
  );

  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    texture,
    0
  );
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, null);

  return {
    framebuffer,
    texture,
    release: () => {
      gl.deleteFramebuffer(framebuffer);
      gl.deleteTexture(texture);
    },
  };
}

function createShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string
) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Unable to create shader.");

  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) ?? "Unknown shader error.";
    gl.deleteShader(shader);
    throw new Error(message);
  }

  return shader;
}

function createCompositeRenderer(gl: WebGL2RenderingContext) {
  const vertexShader = createShader(
    gl,
    gl.VERTEX_SHADER,
    `#version 300 es
    in vec2 a_position;
    out vec2 v_uv;

    void main() {
      v_uv = a_position * 0.5 + 0.5;
      gl_Position = vec4(a_position, 0.0, 1.0);
    }`
  );
  const fragmentShader = createShader(
    gl,
    gl.FRAGMENT_SHADER,
    `#version 300 es
    precision mediump float;

    uniform sampler2D u_source;
    uniform sampler2D u_mask;
    uniform bool u_hasMask;
    in vec2 v_uv;
    out vec4 outColor;

    void main() {
      vec4 color = texture(u_source, v_uv);
      if (u_hasMask) {
        color *= texture(u_mask, v_uv).a;
      }
      outColor = color;
    }`
  );
  const program = gl.createProgram();
  const buffer = gl.createBuffer();
  const vertexArray = gl.createVertexArray();

  if (!program || !buffer || !vertexArray) {
    throw new Error("Unable to create composite renderer.");
  }

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) ?? "Unknown program error.";
    gl.deleteProgram(program);
    gl.deleteBuffer(buffer);
    gl.deleteVertexArray(vertexArray);
    throw new Error(message);
  }

  const positionLocation = gl.getAttribLocation(program, "a_position");
  const sourceLocation = gl.getUniformLocation(program, "u_source");
  const maskLocation = gl.getUniformLocation(program, "u_mask");
  const hasMaskLocation = gl.getUniformLocation(program, "u_hasMask");

  gl.bindVertexArray(vertexArray);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
    gl.STATIC_DRAW
  );
  gl.enableVertexAttribArray(positionLocation);
  gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);

  return {
    draw: (
      source: WebGLTexture,
      mask: WebGLTexture | null,
      blendMode: Live2DBlendMode
    ) => {
      gl.useProgram(program);
      gl.bindVertexArray(vertexArray);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, source);
      gl.uniform1i(sourceLocation, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, mask);
      gl.uniform1i(maskLocation, 1);
      gl.uniform1i(hasMaskLocation, mask ? 1 : 0);
      gl.enable(gl.BLEND);
      if (blendMode === "multiply") {
        gl.blendFuncSeparate(
          gl.DST_COLOR,
          gl.ONE_MINUS_SRC_ALPHA,
          gl.ONE,
          gl.ONE_MINUS_SRC_ALPHA
        );
      } else {
        gl.blendFuncSeparate(
          gl.ONE,
          gl.ONE_MINUS_SRC_ALPHA,
          gl.ONE,
          gl.ONE_MINUS_SRC_ALPHA
        );
      }
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.bindVertexArray(null);
      gl.bindTexture(gl.TEXTURE_2D, null);
    },
    release: () => {
      gl.deleteProgram(program);
      gl.deleteBuffer(buffer);
      gl.deleteVertexArray(vertexArray);
    },
  };
}

function createMvpMatrix(
  CubismMatrix44: FrameworkModules["CubismMatrix44"],
  CubismModelMatrix: FrameworkModules["CubismModelMatrix"],
  model: { getCanvasWidth: () => number; getCanvasHeight: () => number },
  canvas: HTMLCanvasElement,
  layout?: Record<string, number>,
  view?: { panX: number; panY: number; zoom: number }
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
  if (view) {
    projection.translateRelative(view.panX, view.panY);
    projection.scaleRelative(view.zoom, view.zoom);
  }
  return projection;
}

function getLive2DParameters(
  model: {
    getModel: () => Live2DCubismCore.Model;
  },
  parameterNames?: Map<string, string>
): Live2DParameter[] {
  const parameters = model.getModel().parameters;

  return Array.from({ length: parameters.count }, (_, index) => ({
    id: parameters.ids[index],
    name: parameterNames?.get(parameters.ids[index]),
    minimumValue: parameters.minimumValues[index],
    maximumValue: parameters.maximumValues[index],
    defaultValue: parameters.defaultValues[index],
    value: parameters.values[index],
  }));
}

function resolveResource(base: string, path?: string) {
  if (!path) return null;
  if (/^(?:https?:|blob:|data:|\/)/.test(path)) return path;

  return base + path;
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

function setRendererTargetState(
  renderer: CubismWebGLRendererLike,
  fbo: WebGLFramebuffer | null,
  width: number,
  height: number
) {
  renderer.setRenderState(fbo, [0, 0, width, height]);
}

function getVertexPositionsDidChangeBit() {
  if (vertexPositionsDidChangeBit !== null) return vertexPositionsDidChangeBit;

  const utils = (window as any).Live2DCubismCore?.Utils;
  for (let bit = 1; bit < 256; bit <<= 1) {
    if (utils?.hasVertexPositionsDidChangeBit(bit)) {
      vertexPositionsDidChangeBit = bit;
      return bit;
    }
  }

  vertexPositionsDidChangeBit = 0;
  return vertexPositionsDidChangeBit;
}

function markClippingMaskSourcesDirty(cubismModel: {
  getModel: () => Live2DCubismCore.Model;
}) {
  const bit = getVertexPositionsDidChangeBit();
  if (bit === 0) return;

  const drawables = cubismModel.getModel().drawables;
  const maskSourceIndices = new Set<number>();

  for (let drawableIndex = 0; drawableIndex < drawables.count; drawableIndex++) {
    const maskCount = drawables.maskCounts[drawableIndex] ?? 0;
    const masks = drawables.masks[drawableIndex];

    for (let maskIndex = 0; maskIndex < maskCount; maskIndex++) {
      const maskDrawableIndex = masks?.[maskIndex];
      if (maskDrawableIndex === undefined || maskDrawableIndex < 0) continue;

      maskSourceIndices.add(maskDrawableIndex);
    }
  }

  maskSourceIndices.forEach((maskDrawableIndex) => {
    drawables.dynamicFlags[maskDrawableIndex] |= bit;
  });
}

function collectModelDiagnostics(cubismModel: {
  getModel: () => Live2DCubismCore.Model;
  isBlendModeEnabled?: () => boolean;
  isUsingMaskingForOffscreen?: () => boolean;
}): Live2DModelDiagnostics {
  const coreModel = cubismModel.getModel();
  const drawables = coreModel.drawables;
  const maskSourceIndices = new Set<number>();
  const maskPermutations = new Set<string>();
  let clippingDrawableCount = 0;

  for (let drawableIndex = 0; drawableIndex < drawables.count; drawableIndex++) {
    const maskCount = drawables.maskCounts[drawableIndex] ?? 0;
    const masks = drawables.masks[drawableIndex];

    if (maskCount <= 0 || !masks) continue;

    clippingDrawableCount += 1;
    const maskIds: number[] = [];
    for (let maskIndex = 0; maskIndex < maskCount; maskIndex++) {
      const maskDrawableIndex = masks[maskIndex];
      if (maskDrawableIndex === undefined || maskDrawableIndex < 0) continue;

      maskSourceIndices.add(maskDrawableIndex);
      maskIds.push(maskDrawableIndex);
    }
    maskPermutations.add(maskIds.join(","));
  }

  const hiddenMaskSourceIds = Array.from(maskSourceIndices)
    .filter((maskDrawableIndex) => {
      const flag = drawables.dynamicFlags[maskDrawableIndex];
      return !Live2DCubismCore.Utils.hasIsVisibleBit(flag);
    })
    .map(
      (maskDrawableIndex) =>
        drawables.ids[maskDrawableIndex] ?? `Drawable ${maskDrawableIndex}`
    );
  const clippingMaskBufferSize =
    maskPermutations.size > 36 || clippingDrawableCount > 80
      ? 4096
      : maskPermutations.size > 0
        ? 1024
        : 256;
  const maskBufferCount =
    maskPermutations.size <= 36
      ? 1
      : Math.max(2, Math.ceil(maskPermutations.size / 16));

  return {
    drawableCount: drawables.count,
    clippingDrawableCount,
    maskSourceCount: maskSourceIndices.size,
    maskPermutationCount: maskPermutations.size,
    hiddenMaskSourceIds,
    exceedsWebMaskLimit: maskPermutations.size > 36,
    maskBufferCount,
    clippingMaskBufferSize,
    usesBlendMode: cubismModel.isBlendModeEnabled?.() ?? false,
    usesOffscreenMasking: cubismModel.isUsingMaskingForOffscreen?.() ?? false,
  };
}

function getMaskBufferCount(diagnostics: Live2DModelDiagnostics) {
  return diagnostics.maskBufferCount;
}

function configureClippingMaskBuffer(
  renderer: CubismWebGLRendererLike,
  diagnostics: Live2DModelDiagnostics
) {
  renderer.setClippingMaskBufferSize?.(diagnostics.clippingMaskBufferSize);
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
  fitToContainer = false,
  viewTransform,
  viewTransformRef: externalViewTransformRef,
  parameterValues = {},
  parameterValuesRef: externalParameterValuesRef,
  motionRequest,
  expressionRequest,
  effectSettings,
  parameterUpdateFps = 10,
  onParametersLoaded,
  onParameterValuesChanged,
  onViewTransformChanged,
  onModelDiagnostics,
  onMotionsLoaded,
  onExpressionsLoaded,
  transparentCanvas = true,
  backgroundColor = DEFAULT_BACKGROUND_COLOR,
}: Live2DViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [pixelRatio, setPixelRatio] = useState(1);
  const [displaySize, setDisplaySize] = useState({ width, height });
  const internalParameterValuesRef = useRef(parameterValues);
  const parameterValuesRef =
    externalParameterValuesRef ?? internalParameterValuesRef;
  const onParametersLoadedRef = useRef(onParametersLoaded);
  const onParameterValuesChangedRef = useRef(onParameterValuesChanged);
  const onViewTransformChangedRef = useRef(onViewTransformChanged);
  const onModelDiagnosticsRef = useRef(onModelDiagnostics);
  const onMotionsLoadedRef = useRef(onMotionsLoaded);
  const onExpressionsLoadedRef = useRef(onExpressionsLoaded);
  const motionRequestRef = useRef(motionRequest);
  const expressionRequestRef = useRef(expressionRequest);
  const effectSettingsRef = useRef(effectSettings);
  const parameterUpdateFpsRef = useRef(parameterUpdateFps);
  const internalViewTransformRef = useRef<Live2DViewTransform>(
    viewTransform ?? { panX: 0, panY: 0, zoom: 1 }
  );
  const viewTransformRef =
    externalViewTransformRef ?? internalViewTransformRef;
  const dragRef = useRef<{
    pointerId: number;
    lastX: number;
    lastY: number;
  } | null>(null);

  useEffect(() => {
    internalParameterValuesRef.current = parameterValues;
  }, [internalParameterValuesRef, parameterValues]);

  useEffect(() => {
    if (!viewTransform) return;

    viewTransformRef.current = viewTransform;
  }, [viewTransform, viewTransformRef]);

  useEffect(() => {
    onParametersLoadedRef.current = onParametersLoaded;
  }, [onParametersLoaded]);

  useEffect(() => {
    onParameterValuesChangedRef.current = onParameterValuesChanged;
  }, [onParameterValuesChanged]);

  useEffect(() => {
    onViewTransformChangedRef.current = onViewTransformChanged;
  }, [onViewTransformChanged]);
  useEffect(() => {
    onModelDiagnosticsRef.current = onModelDiagnostics;
  }, [onModelDiagnostics]);

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
    effectSettingsRef.current = effectSettings;
  }, [effectSettings]);

  useEffect(() => {
    parameterUpdateFpsRef.current = parameterUpdateFps;
  }, [parameterUpdateFps]);

  useEffect(() => {
    setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  }, []);

  useEffect(() => {
    if (!fitToContainer) {
      setDisplaySize({ width, height });
      return;
    }

    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const updateSize = () => {
      const rect = wrapper.getBoundingClientRect();
      setDisplaySize({
        width: Math.max(1, Math.floor(rect.width)),
        height: Math.max(1, Math.floor(rect.height)),
      });
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(wrapper);

    return () => observer.disconnect();
  }, [fitToContainer, height, width]);

  const handlePointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      lastX: event.clientX,
      lastY: event.clientY,
    };
  };

  const handlePointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    const dx = event.clientX - drag.lastX;
    const dy = event.clientY - drag.lastY;
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;

    viewTransformRef.current = {
      ...viewTransformRef.current,
      panX: viewTransformRef.current.panX + (dx / rect.width) * 2,
      panY: viewTransformRef.current.panY - (dy / rect.height) * 2,
    };
    onViewTransformChangedRef.current?.(viewTransformRef.current);
  };

  const handlePointerUp = (event: PointerEvent<HTMLCanvasElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
    }
  };

  const handleWheel = (event: WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const zoomFactor = Math.exp(-event.deltaY * 0.001);
    const nextZoom = viewTransformRef.current.zoom * zoomFactor;

    viewTransformRef.current = {
      ...viewTransformRef.current,
      zoom: Math.max(0.01, nextZoom),
    };
    onViewTransformChangedRef.current?.(viewTransformRef.current);
  };

  const resetViewTransform = () => {
    viewTransformRef.current = { panX: 0, panY: 0, zoom: 1 };
    onViewTransformChangedRef.current?.(viewTransformRef.current);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let rafId = 0;
    let stopped = false;
    let cubismMoc: { createModel: () => any; deleteModel: (model: any) => void; release: () => void } | null = null;
    let cubismModel: any = null;
    let glContext: WebGL2RenderingContext | null = null;
    let renderer: CubismWebGLRendererLike | null = null;
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
      let wasIdleEnabled = true;
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

      const parameterNames = new Map<string, string>();
      const displayInfoUrl = resolveResource(
        base,
        settings.FileReferences?.DisplayInfo
      );
      if (displayInfoUrl) {
        try {
          const res = await fetch(displayInfoUrl);
          if (!res.ok) throw new Error(`HTTP ${res.status}: ${displayInfoUrl}`);
          const displayInfo = (await res.json()) as DisplayInfo;
          displayInfo.Parameters?.forEach((parameter) => {
            if (!parameter.Id || !parameter.Name) return;

            parameterNames.set(parameter.Id, parameter.Name);
          });
        } catch (e) {
          console.error("[Live2DViewer] Failed to load display info:", e);
        }
      }

      const mocUrl = resolveResource(base, settings.FileReferences?.Moc);
      if (!mocUrl) {
        console.error("[Live2DViewer] Model settings is missing the Moc path.");
        return;
      }

      try {
        const res = await fetch(mocUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${mocUrl}`);
        const mocBuffer = await res.arrayBuffer();
        cubismMoc = CubismMoc.create(mocBuffer, true);
        cubismModel = cubismMoc?.createModel() ?? null;
      } catch (e) {
        console.error("[Live2DViewer] Failed to create Cubism model:", e);
        return;
      }
      if (stopped || !cubismMoc || !cubismModel) return;
      getLive2DParameters(cubismModel, parameterNames).forEach(
        (parameter, index) => {
          parameterIndices.set(parameter.id, index);
        }
      );
      onParametersLoadedRef.current?.(
        getLive2DParameters(cubismModel, parameterNames)
      );
      const diagnostics = collectModelDiagnostics(cubismModel);
      onModelDiagnosticsRef.current?.(diagnostics);
      motionManager = new CubismMotionManager();
      motionManager.setEventCallback(ignoreMotionEvent);
      expressionManager = new CubismExpressionMotionManager();
      expressionManager.setEventCallback(ignoreMotionEvent);
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
      if (idleMotion && (effectSettingsRef.current?.idle ?? true)) {
        await startMotion(idleMotion.group, idleMotion.index, true);
      }
      cubismModel.saveParameters();

      const gl = canvas.getContext("webgl2", {
        premultipliedAlpha: true,
        alpha: transparentCanvas,
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
            loadImage(resolveResource(base, texturePath) ?? "")
          )
        );
        textures = images.map((image) => createTexture(glContext!, image));
      } catch (e) {
        console.error("[Live2DViewer] Failed to load model textures:", e);
        return;
      }
      if (stopped) return;

      renderer = new CubismRenderer_WebGL(canvas.width, canvas.height);
      renderer.initialize(cubismModel, getMaskBufferCount(diagnostics));
      configureClippingMaskBuffer(renderer, diagnostics);
      renderer.startUp(glContext);
      renderer.setIsPremultipliedAlpha(true);
      renderer.setMvpMatrix(
        createMvpMatrix(
          CubismMatrix44,
          CubismModelMatrix,
          cubismModel,
          canvasElement,
          settings.Layout,
          viewTransformRef.current
        )
      );
      textures.forEach((texture, index) => renderer?.bindTexture(index, texture));

      function tick() {
        if (stopped || !cubismModel || !renderer) return;
        const now = performance.now();
        const deltaTimeSeconds = Math.min((now - lastFrameTime) / 1000, 0.1);
        lastFrameTime = now;
        const effects = {
          ...DEFAULT_EFFECT_SETTINGS,
          ...effectSettingsRef.current,
        };

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
        if (!effects.idle && wasIdleEnabled) {
          motionManager?.stopAllMotions();
          idleRestartPending = false;
        }
        wasIdleEnabled = effects.idle;
        if (
          effects.idle &&
          idleMotion &&
          motionManager?.isFinished() &&
          !idleRestartPending
        ) {
          idleRestartPending = true;
          void startMotion(idleMotion.group, idleMotion.index, true);
        }
        cubismModel.saveParameters();
        if (effects.eyeBlink) {
          eyeBlink?.updateParameters(cubismModel, deltaTimeSeconds);
        }
        expressionManager?.updateMotion(cubismModel, deltaTimeSeconds);
        if (effects.breath) {
          breath?.updateParameters(cubismModel, deltaTimeSeconds);
        }
        if (effects.physics) {
          physics?.evaluate(cubismModel, deltaTimeSeconds);
        }
        if (effects.pose) {
          pose?.updateParameters(cubismModel, deltaTimeSeconds);
        }
        Object.entries(parameterValuesRef.current).forEach(([id, value]) => {
          const index = parameterIndices.get(id);
          if (index === undefined) return;

          cubismModel.setParameterValueByIndex(index, value, 1);
        });
        const parameterReportInterval =
          parameterUpdateFpsRef.current <= 0
            ? 0
            : 1000 / parameterUpdateFpsRef.current;
        if (now - lastParameterReportTime >= parameterReportInterval) {
          lastParameterReportTime = now;
          onParameterValuesChangedRef.current?.(
            Object.fromEntries(
              getLive2DParameters(cubismModel, parameterNames).map(
                (parameter) => [parameter.id, parameter.value]
              )
            )
          );
        }

        glContext.viewport(0, 0, canvasElement.width, canvasElement.height);
        glContext.clearColor(...backgroundColor);
        glContext.clear(glContext.COLOR_BUFFER_BIT);
        cubismModel.update();
        renderer.setMvpMatrix(
          createMvpMatrix(
            CubismMatrix44,
            CubismModelMatrix,
            cubismModel,
            canvasElement,
            settings.Layout,
            viewTransformRef.current
          )
        );
        setRendererTargetState(
          renderer,
          null,
          canvasElement.width,
          canvasElement.height
        );
        markClippingMaskSourcesDirty(cubismModel);
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
  }, [
    backgroundColor,
    displaySize.height,
    displaySize.width,
    modelUrl,
    pixelRatio,
    transparentCanvas,
  ]);

  return (
    <div
      ref={wrapperRef}
      style={{
        display: "grid",
        height: fitToContainer ? "100%" : displaySize.height,
        placeItems: "center",
        width: fitToContainer ? "100%" : displaySize.width,
      }}
    >
      <canvas
        ref={canvasRef}
        width={Math.round(displaySize.width * pixelRatio)}
        height={Math.round(displaySize.height * pixelRatio)}
        onDoubleClick={resetViewTransform}
        onPointerCancel={handlePointerUp}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onWheel={handleWheel}
        style={{
          cursor: dragRef.current ? "grabbing" : "grab",
          display: "block",
          height: displaySize.height,
          touchAction: "none",
          width: displaySize.width,
        }}
      />
    </div>
  );
}

interface ResolvedModelLayerProps extends Live2DModelLayerProps {
  parameterValuesRef: MutableRefObject<Record<string, number>>;
  viewTransformRef: MutableRefObject<Live2DViewTransform>;
}

/**
 * Renders multiple Live2D Cubism 5 models on one WebGL canvas.
 */
export function Live2DMultiViewer({
  models,
  width = 400,
  height = 600,
  fitToContainer = false,
  selectedModelUrl,
  transparentCanvas = true,
  backgroundColor = DEFAULT_BACKGROUND_COLOR,
}: Live2DMultiViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [pixelRatio, setPixelRatio] = useState(1);
  const [displaySize, setDisplaySize] = useState({ width, height });
  const modelRefs = useRef(new Map<string, ResolvedModelLayerProps>());
  const internalModelRefs = useRef(
    new Map<
      string,
      {
        parameterValuesRef: MutableRefObject<Record<string, number>>;
        viewTransformRef: MutableRefObject<Live2DViewTransform>;
      }
    >()
  );
  const dragRef = useRef<{
    pointerId: number;
    lastX: number;
    lastY: number;
  } | null>(null);
  const modelUrlsKey = models.map((model) => model.modelUrl).join("\n");

  models.forEach((model) => {
    let internal = internalModelRefs.current.get(model.modelUrl);
    if (!internal) {
      internal = {
        parameterValuesRef: { current: model.parameterValues ?? {} },
        viewTransformRef: {
          current: model.viewTransform ?? { panX: 0, panY: 0, zoom: 1 },
        },
      };
      internalModelRefs.current.set(model.modelUrl, internal);
    }

    if (!model.parameterValuesRef && model.parameterValues) {
      internal.parameterValuesRef.current = model.parameterValues;
    }
    if (!model.viewTransformRef && model.viewTransform) {
      internal.viewTransformRef.current = model.viewTransform;
    }

    modelRefs.current.set(model.modelUrl, {
      ...model,
      parameterValuesRef:
        model.parameterValuesRef ?? internal.parameterValuesRef,
      viewTransformRef: model.viewTransformRef ?? internal.viewTransformRef,
    });
  });

  Array.from(modelRefs.current.keys()).forEach((modelUrl) => {
    if (!models.some((model) => model.modelUrl === modelUrl)) {
      modelRefs.current.delete(modelUrl);
      internalModelRefs.current.delete(modelUrl);
    }
  });

  useEffect(() => {
    setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  }, []);

  useEffect(() => {
    if (!fitToContainer) {
      setDisplaySize({ width, height });
      return;
    }

    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const updateSize = () => {
      const rect = wrapper.getBoundingClientRect();
      setDisplaySize({
        width: Math.max(1, Math.floor(rect.width)),
        height: Math.max(1, Math.floor(rect.height)),
      });
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(wrapper);

    return () => observer.disconnect();
  }, [fitToContainer, height, width]);

  const getInteractiveModel = () => {
    const ordered = models
      .map((model) => modelRefs.current.get(model.modelUrl))
      .filter((model): model is ResolvedModelLayerProps => Boolean(model));

    return (
      ordered.find(
        (model) =>
          model.modelUrl === selectedModelUrl &&
          model.visible !== false &&
          model.interactive !== false
      ) ??
      ordered.find(
        (model) => model.visible !== false && model.interactive !== false
      ) ??
      null
    );
  };

  const handlePointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!getInteractiveModel()) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      lastX: event.clientX,
      lastY: event.clientY,
    };
  };

  const handlePointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    const model = getInteractiveModel();
    if (!drag || !model || drag.pointerId !== event.pointerId) return;

    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    const dx = event.clientX - drag.lastX;
    const dy = event.clientY - drag.lastY;
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;

    model.viewTransformRef.current = {
      ...model.viewTransformRef.current,
      panX: model.viewTransformRef.current.panX + (dx / rect.width) * 2,
      panY: model.viewTransformRef.current.panY - (dy / rect.height) * 2,
    };
    model.onViewTransformChanged?.(model.viewTransformRef.current);
  };

  const handlePointerUp = (event: PointerEvent<HTMLCanvasElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
    }
  };

  const handleWheel = (event: WheelEvent<HTMLCanvasElement>) => {
    const model = getInteractiveModel();
    if (!model) return;

    event.preventDefault();
    const zoomFactor = Math.exp(-event.deltaY * 0.001);
    const nextZoom = model.viewTransformRef.current.zoom * zoomFactor;

    model.viewTransformRef.current = {
      ...model.viewTransformRef.current,
      zoom: Math.max(0.01, nextZoom),
    };
    model.onViewTransformChanged?.(model.viewTransformRef.current);
  };

  const resetViewTransform = () => {
    const model = getInteractiveModel();
    if (!model) return;

    model.viewTransformRef.current = { panX: 0, panY: 0, zoom: 1 };
    model.onViewTransformChanged?.(model.viewTransformRef.current);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || models.length === 0) return;

    let rafId = 0;
    let stopped = false;
    let glContext: WebGL2RenderingContext | null = null;
    let compositeRenderer: ReturnType<typeof createCompositeRenderer> | null =
      null;

    type RuntimeLayer = {
      modelUrl: string;
      cubismMoc: {
        createModel: () => any;
        deleteModel: (model: any) => void;
        release: () => void;
      } | null;
      cubismModel: any;
      renderer: CubismWebGLRendererLike | null;
      renderTarget: ReturnType<typeof createLayerRenderTarget> | null;
      textures: WebGLTexture[];
      motionManager: any;
      expressionManager: any;
      physics: any;
      pose: any;
      eyeBlink: any;
      breath: any;
      parameterNames: Map<string, string>;
      parameterIndices: Map<string, number>;
      lastParameterReportTime: number;
      lastMotionNonce: number;
      lastExpressionNonce: number;
      idleRestartPending: boolean;
      wasIdleEnabled: boolean;
      idleMotion?: { group: string; index: number };
      settings: ModelSettings;
      startMotion: (group: string, index: number, loop: boolean) => Promise<void>;
      startExpression: (index: number) => Promise<void>;
    };

    const runtimeLayers: RuntimeLayer[] = [];

    const releaseLayer = (layer: RuntimeLayer) => {
      layer.renderTarget?.release();
      layer.renderer?.release();
      layer.motionManager?.release();
      layer.expressionManager?.release();
      layer.physics?.release?.();
      layer.textures.forEach((texture) => {
        glContext?.deleteTexture(texture);
      });
      if (layer.cubismMoc && layer.cubismModel) {
        layer.cubismMoc.deleteModel(layer.cubismModel);
      }
      layer.cubismMoc?.release();
    };

    (async () => {
      try {
        await loadScript(CUBISM_CORE_SCRIPT_SRC);
      } catch {
        console.error(
          "[Live2DMultiViewer] Cubism 5 core not found.\n" +
            "Copy live2dcubismcore.min.js to public/live2dcubism/Core/.\n" +
            "See README.md for instructions."
        );
        return;
      }
      if (stopped) return;

      if (!(window as any).Live2DCubismCore) {
        console.error(
          "[Live2DMultiViewer] Live2DCubismCore global not found after loading " +
            `${CUBISM_CORE_SCRIPT_SRC}.`
        );
        return;
      }

      const gl = canvas.getContext("webgl2", {
        premultipliedAlpha: true,
        alpha: transparentCanvas,
      });
      if (!gl) {
        console.error(
          "[Live2DMultiViewer] WebGL2 is required by CubismRenderer_WebGL."
        );
        return;
      }
      glContext = gl;
      compositeRenderer = createCompositeRenderer(gl);

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

      async function createLayer(modelUrl: string): Promise<RuntimeLayer | null> {
        const base = modelUrl.slice(0, modelUrl.lastIndexOf("/") + 1);
        let settings: ModelSettings;
        try {
          const res = await fetch(modelUrl);
          if (!res.ok) throw new Error(`HTTP ${res.status}: ${modelUrl}`);
          settings = (await res.json()) as ModelSettings;
        } catch (e) {
          console.error("[Live2DMultiViewer] Failed to load model settings:", e);
          return null;
        }
        if (stopped) return null;

        const parameterNames = new Map<string, string>();
        const displayInfoUrl = resolveResource(
          base,
          settings.FileReferences?.DisplayInfo
        );
        if (displayInfoUrl) {
          try {
            const res = await fetch(displayInfoUrl);
            if (!res.ok) {
              throw new Error(`HTTP ${res.status}: ${displayInfoUrl}`);
            }
            const displayInfo = (await res.json()) as DisplayInfo;
            displayInfo.Parameters?.forEach((parameter) => {
              if (!parameter.Id || !parameter.Name) return;

              parameterNames.set(parameter.Id, parameter.Name);
            });
          } catch (e) {
            console.error("[Live2DMultiViewer] Failed to load display info:", e);
          }
        }

        const mocUrl = resolveResource(base, settings.FileReferences?.Moc);
        if (!mocUrl) {
          console.error("[Live2DMultiViewer] Model settings is missing the Moc path.");
          return null;
        }

        let cubismMoc:
          | {
              createModel: () => any;
              deleteModel: (model: any) => void;
              release: () => void;
            }
          | null = null;
        let cubismModel: any = null;
        try {
          const res = await fetch(mocUrl);
          if (!res.ok) throw new Error(`HTTP ${res.status}: ${mocUrl}`);
          const mocBuffer = await res.arrayBuffer();
          cubismMoc = CubismMoc.create(mocBuffer, true);
          cubismModel = cubismMoc?.createModel() ?? null;
        } catch (e) {
          console.error("[Live2DMultiViewer] Failed to create Cubism model:", e);
          return null;
        }
        if (stopped || !cubismMoc || !cubismModel) return null;

        const parameterIndices = new Map<string, number>();
        getLive2DParameters(cubismModel, parameterNames).forEach(
          (parameter, index) => {
            parameterIndices.set(parameter.id, index);
          }
        );
        modelRefs.current
          .get(modelUrl)
          ?.onParametersLoaded?.(
            getLive2DParameters(cubismModel, parameterNames)
          );
        const diagnostics = collectModelDiagnostics(cubismModel);
        modelRefs.current.get(modelUrl)?.onModelDiagnostics?.(diagnostics);

        const motionManager = new CubismMotionManager();
        const expressionManager = new CubismExpressionMotionManager();
        motionManager.setEventCallback(ignoreMotionEvent);
        expressionManager.setEventCallback(ignoreMotionEvent);
        const breath = createBreath(modules, cubismModel);
        const eyeBlinkIds = getParameterIdsByGroup(settings, "EyeBlink").filter(
          (id) => hasParameterId(cubismModel, id)
        );
        const motionEyeBlinkIds = eyeBlinkIds.map((id) =>
          CubismFramework.getIdManager().getId(id)
        );
        const motionLipSyncIds = getParameterIdsByGroup(settings, "LipSync")
          .filter((id) => hasParameterId(cubismModel, id))
          .map((id) => CubismFramework.getIdManager().getId(id));
        const eyeBlink =
          eyeBlinkIds.length > 0 ? CubismEyeBlink.create() : null;
        eyeBlink?.setParameterIds(motionEyeBlinkIds);

        const motionDefinitions = new Map<
          string,
          {
            group: string;
            index: number;
            url: string;
            fadeInTime?: number;
            fadeOutTime?: number;
          }
        >();
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
        modelRefs.current.get(modelUrl)?.onMotionsLoaded?.(
          Array.from(motionDefinitions.values()).map((motion) => ({
            group: motion.group,
            index: motion.index,
            name: `${motion.group} ${motion.index + 1}`,
          }))
        );

        const expressionDefinitions: Array<{ name: string; url: string }> = [];
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
        modelRefs.current.get(modelUrl)?.onExpressionsLoaded?.(
          expressionDefinitions.map((expression, index) => ({
            index,
            name: expression.name,
          }))
        );

        let physics: any = null;
        const physicsUrl = resolveResource(
          base,
          settings.FileReferences?.Physics
        );
        if (physicsUrl) {
          try {
            const buffer = await loadArrayBuffer(physicsUrl);
            physics = CubismPhysics.create(buffer, buffer.byteLength);
          } catch (e) {
            console.error("[Live2DMultiViewer] Failed to load physics:", e);
          }
        }

        let pose: any = null;
        const poseUrl = resolveResource(base, settings.FileReferences?.Pose);
        if (poseUrl) {
          try {
            const buffer = await loadArrayBuffer(poseUrl);
            pose = CubismPose.create(buffer, buffer.byteLength);
          } catch (e) {
            console.error("[Live2DMultiViewer] Failed to load pose:", e);
          }
        }

        const runtimeLayer: RuntimeLayer = {
          modelUrl,
          cubismMoc,
          cubismModel,
          renderer: null,
          renderTarget: null,
          textures: [],
          motionManager,
          expressionManager,
          physics,
          pose,
          eyeBlink,
          breath,
          parameterNames,
          parameterIndices,
          lastParameterReportTime: 0,
          lastMotionNonce:
            modelRefs.current.get(modelUrl)?.motionRequest?.nonce ?? 0,
          lastExpressionNonce:
            modelRefs.current.get(modelUrl)?.expressionRequest?.nonce ?? 0,
          idleRestartPending: false,
          wasIdleEnabled: true,
          settings,
          startMotion: async (group, index, loop) => {
            const definition = motionDefinitions.get(`${group}:${index}`);
            if (!definition) return;

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
              console.error("[Live2DMultiViewer] Failed to start motion:", e);
            } finally {
              if (loop) {
                runtimeLayer.idleRestartPending = false;
              }
            }
          },
          startExpression: async (index) => {
            const definition = expressionDefinitions[index];
            if (!definition) return;

            try {
              const buffer = await loadArrayBuffer(definition.url);
              const expression = CubismExpressionMotion.create(
                buffer,
                buffer.byteLength
              );
              expressionManager.startMotion(expression, true);
            } catch (e) {
              console.error("[Live2DMultiViewer] Failed to start expression:", e);
            }
          },
        };

        const idleMotion = Array.from(motionDefinitions.values()).find(
          (motion) => motion.group.toLowerCase().includes("idle")
        );
        if (idleMotion) {
          runtimeLayer.idleMotion = {
            group: idleMotion.group,
            index: idleMotion.index,
          };
          if (modelRefs.current.get(modelUrl)?.effectSettings?.idle ?? true) {
            await runtimeLayer.startMotion(
              idleMotion.group,
              idleMotion.index,
              true
            );
          }
        }
        cubismModel.saveParameters();

        try {
          const images = await Promise.all(
            (settings.FileReferences?.Textures ?? []).map((texturePath) =>
              loadImage(resolveResource(base, texturePath) ?? "")
            )
          );
          runtimeLayer.textures = images.map((image) => createTexture(gl, image));
        } catch (e) {
          console.error("[Live2DMultiViewer] Failed to load model textures:", e);
          releaseLayer(runtimeLayer);
          return null;
        }
        if (stopped) {
          releaseLayer(runtimeLayer);
          return null;
        }

        const renderer = new CubismRenderer_WebGL(canvas.width, canvas.height);
        renderer.initialize(cubismModel, getMaskBufferCount(diagnostics));
        configureClippingMaskBuffer(renderer, diagnostics);
        renderer.startUp(gl);
        renderer.setIsPremultipliedAlpha(true);
        renderer.setMvpMatrix(
          createMvpMatrix(
            CubismMatrix44,
            CubismModelMatrix,
            cubismModel,
            canvas,
            settings.Layout,
            modelRefs.current.get(modelUrl)?.viewTransformRef.current
          )
        );
        runtimeLayer.textures.forEach((texture, index) =>
          renderer.bindTexture(index, texture)
        );
        runtimeLayer.renderer = renderer;
        runtimeLayer.renderTarget = createLayerRenderTarget(
          gl,
          canvas.width,
          canvas.height
        );

        return runtimeLayer;
      }

      for (const model of models) {
        const layer = await createLayer(model.modelUrl);
        if (layer) runtimeLayers.push(layer);
      }
      if (stopped) return;

      let lastFrameTime = performance.now();

      function tick() {
        if (stopped || !glContext) return;

        const now = performance.now();
        const deltaTimeSeconds = Math.min((now - lastFrameTime) / 1000, 0.1);
        lastFrameTime = now;

        const layersByUrl = new Map(
          runtimeLayers.map((layer) => [layer.modelUrl, layer])
        );
        const maskModelUrls = new Set(
          Array.from(modelRefs.current.values())
            .filter((config) => config.visible !== false && config.clipToModelUrl)
            .map((config) => config.clipToModelUrl as string)
        );

        runtimeLayers.forEach((layer) => {
          const config = modelRefs.current.get(layer.modelUrl);
          const shouldRender =
            Boolean(config) &&
            (config?.visible !== false || maskModelUrls.has(layer.modelUrl));
          const shouldRenderTarget =
            Boolean(config) &&
            (maskModelUrls.has(layer.modelUrl) ||
              (config?.visible !== false &&
                (Boolean(config?.clipToModelUrl) ||
                  (config?.blendMode ?? "normal") !== "normal")));
          if (
            !config ||
            !shouldRender ||
            !layer.renderer
          ) {
            return;
          }

          const requestedMotion = config.motionRequest;
          if (requestedMotion && requestedMotion.nonce !== layer.lastMotionNonce) {
            layer.lastMotionNonce = requestedMotion.nonce;
            void layer.startMotion(
              requestedMotion.group,
              requestedMotion.index,
              false
            );
          }
          const requestedExpression = config.expressionRequest;
          if (
            requestedExpression &&
            requestedExpression.nonce !== layer.lastExpressionNonce
          ) {
            layer.lastExpressionNonce = requestedExpression.nonce;
            void layer.startExpression(requestedExpression.index);
          }
          const effects = {
            ...DEFAULT_EFFECT_SETTINGS,
            ...config.effectSettings,
          };

          layer.cubismModel.loadParameters();
          layer.motionManager?.updateMotion(
            layer.cubismModel,
            deltaTimeSeconds
          );
          if (!effects.idle && layer.wasIdleEnabled) {
            layer.motionManager?.stopAllMotions();
            layer.idleRestartPending = false;
          }
          layer.wasIdleEnabled = effects.idle;
          if (
            effects.idle &&
            layer.idleMotion &&
            layer.motionManager?.isFinished() &&
            !layer.idleRestartPending
          ) {
            layer.idleRestartPending = true;
            void layer.startMotion(
              layer.idleMotion.group,
              layer.idleMotion.index,
              true
            );
          }
          layer.cubismModel.saveParameters();
          if (effects.eyeBlink) {
            layer.eyeBlink?.updateParameters(
              layer.cubismModel,
              deltaTimeSeconds
            );
          }
          layer.expressionManager?.updateMotion(
            layer.cubismModel,
            deltaTimeSeconds
          );
          if (effects.breath) {
            layer.breath?.updateParameters(
              layer.cubismModel,
              deltaTimeSeconds
            );
          }
          if (effects.physics) {
            layer.physics?.evaluate(layer.cubismModel, deltaTimeSeconds);
          }
          if (effects.pose) {
            layer.pose?.updateParameters(layer.cubismModel, deltaTimeSeconds);
          }

          Object.entries(config.parameterValuesRef.current).forEach(
            ([id, value]) => {
              const index = layer.parameterIndices.get(id);
              if (index === undefined) return;

              layer.cubismModel.setParameterValueByIndex(index, value, 1);
            }
          );

          const parameterUpdateFps = config.parameterUpdateFps ?? 10;
          const parameterReportInterval =
            parameterUpdateFps <= 0 ? 0 : 1000 / parameterUpdateFps;
          if (now - layer.lastParameterReportTime >= parameterReportInterval) {
            layer.lastParameterReportTime = now;
            config.onParameterValuesChanged?.(
              Object.fromEntries(
                getLive2DParameters(
                  layer.cubismModel,
                  layer.parameterNames
                ).map((parameter) => [parameter.id, parameter.value])
              )
            );
          }

          layer.cubismModel.update();
          if (shouldRenderTarget && layer.renderTarget) {
            glContext.bindFramebuffer(
              glContext.FRAMEBUFFER,
              layer.renderTarget.framebuffer
            );
            glContext.viewport(0, 0, canvas.width, canvas.height);
            glContext.clearColor(0, 0, 0, 0);
            glContext.clear(glContext.COLOR_BUFFER_BIT);
            layer.renderer.setMvpMatrix(
              createMvpMatrix(
                CubismMatrix44,
                CubismModelMatrix,
                layer.cubismModel,
                canvas,
                layer.settings.Layout,
                config.viewTransformRef.current
              )
            );
            setRendererTargetState(
              layer.renderer,
              layer.renderTarget.framebuffer,
              canvas.width,
              canvas.height
            );
            markClippingMaskSourcesDirty(layer.cubismModel);
            layer.renderer.drawModel(CUBISM_SHADER_DIR);
          }
        });

        glContext.bindFramebuffer(glContext.FRAMEBUFFER, null);
        glContext.viewport(0, 0, canvas.width, canvas.height);
        glContext.clearColor(...backgroundColor);
        glContext.clear(glContext.COLOR_BUFFER_BIT);

        runtimeLayers.forEach((layer) => {
          const config = modelRefs.current.get(layer.modelUrl);
          if (!config || config.visible === false || !layer.renderer) {
            return;
          }
          const shouldComposite =
            Boolean(config.clipToModelUrl) ||
            (config.blendMode ?? "normal") !== "normal";

          if (!shouldComposite) {
            layer.renderer.setMvpMatrix(
              createMvpMatrix(
                CubismMatrix44,
                CubismModelMatrix,
                layer.cubismModel,
                canvas,
                layer.settings.Layout,
                config.viewTransformRef.current
              )
            );
            setRendererTargetState(
              layer.renderer,
              null,
              canvas.width,
              canvas.height
            );
            markClippingMaskSourcesDirty(layer.cubismModel);
            layer.renderer.drawModel(CUBISM_SHADER_DIR);
            return;
          }

          if (!layer.renderTarget) return;

          const maskLayer = config.clipToModelUrl
            ? layersByUrl.get(config.clipToModelUrl)
            : null;

          compositeRenderer?.draw(
            layer.renderTarget.texture,
            maskLayer?.renderTarget?.texture ?? null,
            config.blendMode ?? "normal"
          );
        });

        rafId = requestAnimationFrame(tick);
      }

      rafId = requestAnimationFrame(tick);
    })().catch((err) => {
      if (!stopped) console.error("[Live2DMultiViewer] Unexpected error:", err);
    });

    return () => {
      stopped = true;
      cancelAnimationFrame(rafId);
      glContext?.bindFramebuffer(glContext.FRAMEBUFFER, null);
      runtimeLayers.forEach(releaseLayer);
      if (glContext) {
        try {
          compositeRenderer?.release();
        } catch {
          // Ignore cleanup failures from a lost WebGL context.
        }
      }
    };
  }, [
    backgroundColor,
    displaySize.height,
    displaySize.width,
    modelUrlsKey,
    pixelRatio,
    transparentCanvas,
  ]);

  return (
    <div
      ref={wrapperRef}
      style={{
        display: "grid",
        height: fitToContainer ? "100%" : displaySize.height,
        placeItems: "center",
        width: fitToContainer ? "100%" : displaySize.width,
      }}
    >
      <canvas
        ref={canvasRef}
        width={Math.round(displaySize.width * pixelRatio)}
        height={Math.round(displaySize.height * pixelRatio)}
        onDoubleClick={resetViewTransform}
        onPointerCancel={handlePointerUp}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onWheel={handleWheel}
        style={{
          cursor: getInteractiveModel() ? "grab" : "default",
          display: "block",
          height: displaySize.height,
          touchAction: "none",
          width: displaySize.width,
        }}
      />
    </div>
  );
}
