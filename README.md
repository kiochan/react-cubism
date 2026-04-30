# react-cubism

A React component library for rendering Live2D Cubism 5 models in the browser via WebGL.

## Workspace structure

```
root/
  package.json          # workspace root
  pnpm-workspace.yaml
  tsconfig.base.json    # shared TypeScript config

  packages/
    live2d-react/       # React component library
      src/
        index.ts
        Live2DViewer.tsx

  apps/
    demo/               # Next.js 15 demo / test app
      app/
        layout.tsx
        page.tsx
```

## Prerequisites

### 1 – Install dependencies

```bash
pnpm install
```

### 2 – Obtain the Live2D Cubism 5 SDK core file (required)

The Cubism 5 Core runtime (`live2dcubismcore.min.js`) is **not** available on
npm. You must download it manually from the official SDK:

1. Visit <https://www.live2d.com/en/sdk/download/web/> and download
   **Cubism SDK for Web**.
2. Inside the ZIP, find `Core/live2dcubismcore.min.js`.
3. Copy it to:
   ```
   apps/demo/public/live2dcubism/core/live2dcubismcore.min.js
   ```
   The component loads this file at runtime via a dynamic `<script>` tag.

### 3 – Add a model (optional, for live preview)

Copy a Cubism 5 model directory (containing `*.model3.json`, `*.moc3`, and
textures) to `apps/demo/public/models/<name>/`.

Then update the `modelUrl` prop in `apps/demo/app/page.tsx`:

```tsx
<Live2DViewer
  modelUrl="/models/<name>/<name>.model3.json"
  width={400}
  height={600}
/>
```

## Development

```bash
pnpm dev          # starts the Next.js dev server at http://localhost:3000
```

`apps/demo` uses `transpilePackages: ["live2d-react"]` in `next.config.ts`,
so Next.js compiles the library's TypeScript source directly — no separate
build step is needed during development.

## Production build

```bash
pnpm build        # builds live2d-react → dist/, then builds the Next.js app
```

## Component API

```tsx
import { Live2DViewer } from "live2d-react";

<Live2DViewer
  modelUrl="/models/example/example.model3.json"
  width={400}   // default: 400
  height={600}  // default: 600
/>
```

| Prop       | Type     | Required | Description                                  |
| ---------- | -------- | -------- | -------------------------------------------- |
| `modelUrl` | `string` | ✓        | URL to the `.model3.json` settings file      |
| `width`    | `number` |          | Canvas width in pixels (default `400`)       |
| `height`   | `number` |          | Canvas height in pixels (default `600`)      |

## Extending the rendering pipeline

The current implementation uses the **Cubism 5 Core** API to load and update
the model. Full rendering (textures, physics, expressions, lip-sync) requires
the **Cubism Web Framework** TypeScript files.

To integrate them:

1. Copy the `Framework/src/` directory from CubismWebSamples into
   `packages/live2d-react/vendor/cubism-framework/`.
2. Add the vendor path to `packages/live2d-react/tsconfig.json`.
3. Import and initialise `CubismFramework` and `CubismRenderer_WebGL` inside
   `Live2DViewer.tsx` following the official sample app pattern.

## License

MIT — see [LICENSE](./LICENSE).

> **Note:** The Live2D Cubism SDK Core is distributed under the
> [Live2D Proprietary Software License Agreement](https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html).
> The Framework source code is under the
> [Live2D Open Software License](https://www.live2d.com/eula/live2d-open-software-license-agreement_en.html).

