import { existsSync, readdirSync, statSync } from "fs";
import { join } from "path";
import {
  Live2DViewerClient,
  type ModelOption,
} from "./Live2DViewerClient";

export const dynamic = "force-dynamic";

function getModelOptions(): ModelOption[] {
  const publicDirCandidates = [
    join(process.cwd(), "public"),
    join(process.cwd(), "apps", "demo", ".next", "standalone", "public"),
    join(process.cwd(), "apps", "demo", "public"),
  ];
  const publicDir =
    publicDirCandidates.find((candidate) => existsSync(candidate)) ??
    publicDirCandidates[0];
  const roots: Array<{
    label: string;
    source: ModelOption["source"];
    fileSystemPath: string;
    publicPath: string;
  }> = [
    {
      label: "Custom",
      source: "models",
      fileSystemPath: join(publicDir, "models"),
      publicPath: "/models",
    },
    {
      label: "SDK Sample",
      source: "samples",
      fileSystemPath: join(
        publicDir,
        "live2dcubism",
        "Samples",
        "Resources"
      ),
      publicPath: "/live2dcubism/Samples/Resources",
    },
  ];

  return roots.flatMap((root) => {
    if (!existsSync(root.fileSystemPath)) return [];

    return readdirSync(root.fileSystemPath)
      .filter((entryName) =>
        statSync(join(root.fileSystemPath, entryName)).isDirectory()
      )
      .flatMap((modelDirName) => {
        const modelDir = join(root.fileSystemPath, modelDirName);
        const modelFileName = readdirSync(modelDir).find((entryName) =>
          entryName.endsWith(".model3.json")
        );

        if (!modelFileName) return [];

        return [
          {
            label: `${root.label}: ${modelDirName}`,
            source: root.source,
            url: `${root.publicPath}/${modelDirName}/${modelFileName}`,
          },
        ];
      });
  });
}

export default function HomePage() {
  const models = getModelOptions();
  const defaultModelUrl = models[0]?.url ?? "/models/ren/ren.model3.json";

  return (
    <main className="app-shell">
      <Live2DViewerClient
        modelUrl={defaultModelUrl}
        models={models}
        width={520}
        height={760}
      />
    </main>
  );
}
