"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";

// Dynamically import the viewer with SSR disabled because Live2DViewer requires
// browser APIs (WebGL, fetch) that are not available on the server.
const Live2DViewerDynamic = dynamic(
  () => import("live2d-react").then((m) => m.Live2DViewer),
  { ssr: false, loading: () => <canvas width={400} height={600} /> }
);

export interface ModelOption {
  label: string;
  url: string;
  source: "models" | "samples";
}

interface Props {
  modelUrl: string;
  models?: ModelOption[];
  width?: number;
  height?: number;
}

export function Live2DViewerClient({
  modelUrl,
  models = [],
  width = 400,
  height = 600,
}: Props) {
  const options = useMemo<ModelOption[]>(
    () =>
      models.length > 0
        ? models
        : [{ label: modelUrl, url: modelUrl, source: "models" }],
    [modelUrl, models]
  );
  const [selectedUrl, setSelectedUrl] = useState(modelUrl);

  return (
    <section style={{ display: "grid", gap: "1rem", maxWidth: width }}>
      <label
        style={{
          display: "grid",
          gap: "0.35rem",
          fontSize: "0.9rem",
          fontWeight: 600,
        }}
      >
        Model
        <select
          suppressHydrationWarning
          value={selectedUrl}
          onChange={(event) => setSelectedUrl(event.target.value)}
          style={{
            font: "inherit",
            padding: "0.5rem 0.65rem",
            border: "1px solid #c8c8c8",
            borderRadius: 6,
            background: "white",
          }}
        >
          {options.map((model) => (
            <option key={model.url} value={model.url}>
              {model.label}
            </option>
          ))}
        </select>
      </label>
      <Live2DViewerDynamic
        key={selectedUrl}
        modelUrl={selectedUrl}
        width={width}
        height={height}
      />
    </section>
  );
}
