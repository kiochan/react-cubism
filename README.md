# react-cubism

A React component library and Next.js demo for rendering Live2D Cubism 5 models
in the browser with the official Cubism Web Framework renderer.

## Workspace

```text
root/
  packages/live2d-react/          # React component library
  apps/demo/                      # Next.js demo app
```

## Install

```bash
pnpm install
```

## Initialize Cubism SDK Files

The Live2D Cubism SDK and model assets are not committed to this repository.
After cloning, download **Cubism SDK for Web** from:

<https://www.live2d.com/en/sdk/download/web/>

Then copy these files from the SDK into the local workspace.

### 1. Public runtime files

Copy the SDK files used by the browser into the demo public directory:

```text
apps/demo/public/live2dcubism/
```

The result should include at least:

```text
apps/demo/public/live2dcubism/Core/live2dcubismcore.min.js
apps/demo/public/live2dcubism/Framework/Shaders/WebGL/
apps/demo/public/live2dcubism/Samples/Resources/
```

Case matters. The app loads the core from:

```text
/live2dcubism/Core/live2dcubismcore.min.js
```

### 2. Framework source for the library

Copy the SDK framework TypeScript source into the package vendor directory:

```text
SDK/Framework/src/
  -> packages/live2d-react/src/vendor/cubism-framework/
```

Also copy the Cubism Core type definition:

```text
SDK/Core/live2dcubismcore.d.ts
  -> packages/live2d-react/src/vendor/live2dcubismcore.d.ts
```

These files are ignored by git because they come from the Live2D SDK.

### 3. Optional custom models

Put custom models under:

```text
apps/demo/public/models/<model-name>/
```

Each model folder should contain its `.model3.json`, `.moc3`, textures, and any
optional physics, motion, expression, or display info files referenced by the
model settings.

The demo automatically lists models from both:

```text
apps/demo/public/models/
apps/demo/public/live2dcubism/Samples/Resources/
```

## Development

```bash
pnpm dev
```

The demo runs at:

```text
http://localhost:3000
```

## Type Check

```bash
pnpm --filter live2d-react typecheck
pnpm --filter demo typecheck
```

## Build

```bash
pnpm build
```

## Component API

```tsx
import { Live2DViewer } from "live2d-react";

<Live2DViewer
  modelUrl="/models/example/example.model3.json"
  width={400}
  height={600}
/>;
```

| Prop       | Type     | Required | Description                             |
| ---------- | -------- | -------- | --------------------------------------- |
| `modelUrl` | `string` | Yes      | URL to the `.model3.json` settings file |
| `width`    | `number` | No       | Canvas width in pixels, default `400`   |
| `height`   | `number` | No       | Canvas height in pixels, default `600`  |

## Git-Ignored Local Assets

These paths are intentionally ignored:

```text
apps/demo/public/live2dcubism/
apps/demo/public/models/
packages/live2d-react/src/vendor/
```

Keep only placeholder `.gitkeep` files in those directories.

## License

MIT. See [LICENSE](./LICENSE).

The Live2D Cubism SDK Core is distributed under the Live2D Proprietary Software
License Agreement. The Cubism Web Framework source is distributed under the
Live2D Open Software License.
