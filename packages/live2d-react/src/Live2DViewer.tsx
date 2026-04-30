"use client";

import { useEffect, useRef } from "react";

export interface Live2DViewerProps {
  /** URL to the .model3.json settings file */
  modelUrl: string;
  width?: number;
  height?: number;
}

/** Dynamically inserts a <script> tag; resolves immediately if already loaded. */
function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const el = document.createElement("script");
    el.src = src;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error(`Cannot load script: ${src}`));
    document.head.appendChild(el);
  });
}

/**
 * Renders a Live2D Cubism 5 model on a WebGL canvas.
 *
 * Prerequisites (see README for details):
 *  1. Copy `live2dcubismcore.min.js` from the Cubism 5 SDK into
 *     `apps/demo/public/live2dcubism/core/live2dcubismcore.min.js`.
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let cubismModel: any = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let cubismMoc: any = null;

    (async () => {
      // ── Step 1: Load Cubism 5 Core runtime ──────────────────────────────────
      // Download CubismWebSamples from https://github.com/Live2D/CubismWebSamples
      // and copy Core/live2dcubismcore.min.js to:
      //   apps/demo/public/live2dcubism/core/live2dcubismcore.min.js
      try {
        await loadScript("/live2dcubism/core/live2dcubismcore.min.js");
      } catch {
        console.error(
          "[Live2DViewer] Cubism 5 core not found.\n" +
            "Copy live2dcubismcore.min.js to public/live2dcubism/core/.\n" +
            "See README.md for instructions."
        );
        return;
      }
      if (stopped) return;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const Core = (window as any).Live2DCubismCore;
      if (!Core) {
        console.error("[Live2DViewer] Live2DCubismCore global not found.");
        return;
      }

      // ── Step 2: Fetch model settings (.model3.json) ──────────────────────────
      const base = modelUrl.slice(0, modelUrl.lastIndexOf("/") + 1);
      let settings: { FileReferences?: { Moc?: string; Textures?: string[] } };
      try {
        const res = await fetch(modelUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${modelUrl}`);
        settings = (await res.json()) as typeof settings;
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

      // ── Step 3: Fetch MOC3 binary ────────────────────────────────────────────
      let mocBuffer: ArrayBuffer;
      try {
        const res = await fetch(base + mocPath);
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${mocPath}`);
        mocBuffer = await res.arrayBuffer();
      } catch (e) {
        console.error("[Live2DViewer] Failed to load MOC file:", e);
        return;
      }
      if (stopped) return;

      // ── Step 4: Create Cubism Core Moc + Model ───────────────────────────────
      cubismMoc = Core.Moc.fromArrayBuffer(mocBuffer);
      if (!cubismMoc) {
        console.error("[Live2DViewer] Core.Moc.fromArrayBuffer() returned null.");
        return;
      }
      cubismModel = Core.Model.fromMoc(cubismMoc);
      if (!cubismModel) {
        console.error("[Live2DViewer] Core.Model.fromMoc() returned null.");
        cubismMoc.release();
        cubismMoc = null;
        return;
      }

      // ── Step 5: Initialise WebGL context ─────────────────────────────────────
      const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
      if (!gl) {
        console.error("[Live2DViewer] WebGL is not available in this browser.");
        return;
      }

      // ── Step 6: Render loop ──────────────────────────────────────────────────
      // This drives parameter updates each frame.
      // Full rendering (textures, physics, expressions) requires integrating
      // the CubismFramework TypeScript files from the Cubism Web SDK.
      // See README.md for the complete integration guide.
      function tick() {
        if (stopped) return;
        cubismModel?.update();
        rafId = requestAnimationFrame(tick);
      }
      rafId = requestAnimationFrame(tick);
    })().catch((err) => {
      if (!stopped) console.error("[Live2DViewer] Unexpected error:", err);
    });

    return () => {
      stopped = true;
      cancelAnimationFrame(rafId);
      cubismModel?.release?.();
      cubismMoc?.release?.();
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
