import { Live2DViewerClient } from "./Live2DViewerClient";

export default function HomePage() {
  return (
    <main style={{ padding: "2rem", fontFamily: "sans-serif" }}>
      <h1>Live2D Cubism 5 Demo</h1>
      <p>
        Place your model files under{" "}
        <code>apps/demo/public/models/&lt;name&gt;/</code> and update the{" "}
        <code>modelUrl</code> prop below.
      </p>
      <p>
        See <strong>README.md</strong> for instructions on adding the Cubism 5
        SDK core file.
      </p>
      <Live2DViewerClient
        modelUrl="/models/example/example.model3.json"
        width={400}
        height={600}
      />
    </main>
  );
}
