"use client";

import dynamic from "next/dynamic";

// Dynamically import the viewer with SSR disabled — Live2DViewer requires
// browser APIs (WebGL, fetch) that are not available on the server.
const Live2DViewerDynamic = dynamic(
  () => import("live2d-react").then((m) => m.Live2DViewer),
  { ssr: false, loading: () => <canvas width={400} height={600} /> }
);

interface Props {
  modelUrl: string;
  width?: number;
  height?: number;
}

export function Live2DViewerClient({ modelUrl, width, height }: Props) {
  return <Live2DViewerDynamic modelUrl={modelUrl} width={width} height={height} />;
}
