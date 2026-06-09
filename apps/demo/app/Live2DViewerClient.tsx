"use client";

import dynamic from "next/dynamic";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  Live2DBlendMode,
  Live2DEffectSettings,
  Live2DExpressionOption,
  Live2DExpressionRequest,
  Live2DModelDiagnostics,
  Live2DMotionOption,
  Live2DMotionRequest,
  Live2DParameter,
  Live2DViewTransform,
} from "live2d-react";

// Dynamically import the viewer with SSR disabled because Live2D rendering uses
// browser APIs (WebGL, fetch) that are not available on the server.
const Live2DViewerDynamic = dynamic(
  () => import("live2d-react").then((m) => m.Live2DMultiViewer),
  { ssr: false, loading: () => <canvas width={400} height={600} /> }
);

export interface ModelOption {
  label: string;
  url: string;
  source: "models" | "samples" | "local";
}

type ModelSource = ModelOption["source"];

interface Props {
  modelUrl: string;
  models?: ModelOption[];
  width?: number;
  height?: number;
}

const PARAMETER_UPDATE_RATES = [
  { label: "Realtime", value: 0 },
  { label: "30 FPS", value: 30 },
  { label: "10 FPS", value: 10 },
  { label: "4 FPS", value: 4 },
  { label: "1 FPS", value: 1 },
];

const DEFAULT_VIEW_TRANSFORM: Live2DViewTransform = {
  panX: 0,
  panY: 0,
  zoom: 1,
};
const DEFAULT_INSPECTOR_WIDTH = 324;
const MIN_INSPECTOR_WIDTH = 280;
const MAX_INSPECTOR_WIDTH = 560;

const BLEND_MODE_OPTIONS: Array<{ label: string; value: Live2DBlendMode }> = [
  { label: "Normal", value: "normal" },
  { label: "Multiply", value: "multiply" },
];

const MODEL_SOURCE_OPTIONS: Array<{ label: string; source: ModelSource }> = [
  { label: "Local", source: "local" },
  { label: "Custom", source: "models" },
  { label: "Samples", source: "samples" },
];

const INSPECTOR_CARD_LABELS = {
  parameterSync: "Parameter-Sync",
  positionSync: "Position-Sync",
  layer: "Layer Mode",
  effects: "Effects",
  parameters: "Parameters",
  motions: "Motions",
  expressions: "Expressions",
  position: "Position",
} as const;

type InspectorCardId = keyof typeof INSPECTOR_CARD_LABELS;

const INSPECTOR_PANEL_OPTIONS = [
  { id: "globalSync", label: "Global Sync Settings" },
  { id: "layer", label: "Layer Settings" },
  { id: "modelControls", label: "Model Controls" },
  { id: "parameters", label: "Parameters" },
] as const;

type InspectorPanelId = (typeof INSPECTOR_PANEL_OPTIONS)[number]["id"];

interface ParameterSyncRule {
  id: string;
  enabled: boolean;
  sourceUrl: string;
  targetUrl: string;
  mappingsText: string;
}

interface SyncedParameters {
  targetUrl: string;
  parameterIds: string[];
}

interface PositionSyncState {
  enabled: boolean;
  expressionText: string;
}

interface LayerRenderSettings {
  blendMode: Live2DBlendMode;
  clipToModelUrl: string;
}

const DEFAULT_EFFECT_SETTINGS: Required<Live2DEffectSettings> = {
  idle: false,
  eyeBlink: false,
  breath: false,
  physics: false,
  pose: false,
};

const EFFECT_OPTIONS: Array<{
  key: keyof Required<Live2DEffectSettings>;
  label: string;
  description: string;
}> = [
  {
    key: "idle",
    label: "Idle",
    description: "Auto-loop standby motions",
  },
  {
    key: "eyeBlink",
    label: "EyeBlink",
    description: "Model group driven blinking",
  },
  {
    key: "breath",
    label: "Breath",
    description: "Extra breathing parameter motion",
  },
  {
    key: "physics",
    label: "Physics",
    description: "Hair, cloth, and accessory dynamics",
  },
  {
    key: "pose",
    label: "Pose",
    description: "Part visibility and pose links",
  },
];

const LOCAL_MODEL_DB_NAME = "react-cubism-local-models";
const LOCAL_MODEL_DB_VERSION = 1;
const LOCAL_MODEL_STORE_NAME = "directories";

interface LocalModelOption extends ModelOption {
  objectUrls: string[];
  cacheId?: string;
}

interface LocalFileEntry {
  file: File;
  path: string;
}

interface LocalDirectoryHandle {
  kind: "directory";
  name: string;
  entries(): AsyncIterableIterator<[string, LocalFileSystemHandle]>;
  queryPermission?(options?: { mode: "read" }): Promise<PermissionState>;
  requestPermission?(options?: { mode: "read" }): Promise<PermissionState>;
}

interface LocalFileHandle {
  kind: "file";
  name: string;
  getFile(): Promise<File>;
}

type LocalFileSystemHandle = LocalDirectoryHandle | LocalFileHandle;

interface CachedLocalDirectory {
  id: string;
  name: string;
  handle: LocalDirectoryHandle;
}

interface WindowWithFileSystemAccess extends Window {
  showDirectoryPicker?: () => Promise<LocalDirectoryHandle>;
}

type ModelSettingsFileReferences = {
  Moc?: string;
  Textures?: string[];
  Physics?: string;
  Pose?: string;
  DisplayInfo?: string;
  Expressions?: Array<{
    File?: string;
  }>;
  Motions?: Record<
    string,
    Array<{
      File?: string;
    }>
  >;
};

interface LocalModelSettings {
  FileReferences?: ModelSettingsFileReferences;
}

interface ParameterMappingRule {
  sourceModel?: string;
  sourcePattern: string;
  targetModel?: string;
  targetPattern: string;
}

interface ResolvedParameterMapping {
  sourceUrl: string;
  sourceId: string;
  targetUrl: string;
  targetId: string;
}

function parseParameterMappings(text: string) {
  return text
    .split(/[\n,;]+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line): ParameterMappingRule[] => {
      const separator = line.includes("=>") ? "=>" : "=";
      const [sourceId, targetId] = line.split(separator).map((part) =>
        part.trim()
      );

      if (!sourceId || !targetId) return [];
      const source = parseMappingSide(sourceId);
      const target = parseMappingSide(targetId);

      return [
        {
          sourceModel: source.model,
          sourcePattern: source.parameter,
          targetModel: target.model,
          targetPattern: target.parameter,
        },
      ];
    });
}

function parseMappingSide(value: string) {
  const separatorIndex = value.indexOf(":");
  if (separatorIndex === -1) {
    return { parameter: value };
  }

  const model = value.slice(0, separatorIndex).trim();
  const parameter = value.slice(separatorIndex + 1).trim();

  return model && parameter ? { model, parameter } : { parameter: value };
}

function normalizeSearchValue(value: string) {
  return value.toLowerCase().replace(/[\s_-]+/g, "");
}

function resolveModelUrl(
  token: string | undefined,
  fallbackUrl: string,
  options: ModelOption[]
) {
  if (!token) return fallbackUrl;

  const normalizedToken = normalizeSearchValue(token);
  const match = options.find((model) => {
    const normalizedLabel = normalizeSearchValue(model.label);
    const normalizedUrl = normalizeSearchValue(model.url);

    return (
      normalizedLabel === normalizedToken ||
      normalizedUrl === normalizedToken ||
      normalizedLabel.includes(normalizedToken) ||
      normalizedUrl.includes(normalizedToken)
    );
  });

  return match?.url ?? fallbackUrl;
}

function normalizeLocalPath(path: string) {
  return path.replace(/\\/g, "/").replace(/^\.?\//, "");
}

function dirname(path: string) {
  const normalizedPath = normalizeLocalPath(path);
  const slashIndex = normalizedPath.lastIndexOf("/");

  return slashIndex === -1 ? "" : normalizedPath.slice(0, slashIndex);
}

function joinLocalPath(basePath: string, resourcePath: string) {
  const parts = [...basePath.split("/"), ...resourcePath.split("/")];
  const normalizedParts: string[] = [];

  parts.forEach((part) => {
    if (!part || part === ".") return;
    if (part === "..") {
      normalizedParts.pop();
      return;
    }
    normalizedParts.push(part);
  });

  return normalizedParts.join("/");
}

function isRemoteOrBlobUrl(value: string) {
  return /^(?:https?:|blob:|data:|\/)/.test(value);
}

function resolveLocalObjectUrl(
  fileUrls: Map<string, string>,
  modelDir: string,
  resourcePath: string | undefined
) {
  if (!resourcePath || isRemoteOrBlobUrl(resourcePath)) return resourcePath;

  const normalizedResourcePath = normalizeLocalPath(resourcePath);
  const localPath = joinLocalPath(modelDir, normalizedResourcePath);
  const basename = normalizedResourcePath.split("/").pop() ?? "";

  return (
    fileUrls.get(localPath) ??
    fileUrls.get(normalizedResourcePath) ??
    Array.from(fileUrls.entries()).find(
      ([path]) => path === basename || path.endsWith(`/${basename}`)
    )
      ?.[1] ??
    resourcePath
  );
}

function rewriteLocalResource(
  fileUrls: Map<string, string>,
  modelDir: string,
  resourcePath: string | undefined
) {
  return resolveLocalObjectUrl(fileUrls, modelDir, resourcePath);
}

function rewriteLocalModelSettings(
  settings: LocalModelSettings,
  fileUrls: Map<string, string>,
  modelDir: string
) {
  const refs = settings.FileReferences;
  if (!refs) return settings;

  return {
    ...settings,
    FileReferences: {
      ...refs,
      Moc: rewriteLocalResource(fileUrls, modelDir, refs.Moc),
      Textures: refs.Textures?.map((texture) =>
        rewriteLocalResource(fileUrls, modelDir, texture) ?? texture
      ),
      Physics: rewriteLocalResource(fileUrls, modelDir, refs.Physics),
      Pose: rewriteLocalResource(fileUrls, modelDir, refs.Pose),
      DisplayInfo: rewriteLocalResource(fileUrls, modelDir, refs.DisplayInfo),
      Expressions: refs.Expressions?.map((expression) => ({
        ...expression,
        File: rewriteLocalResource(fileUrls, modelDir, expression.File),
      })),
      Motions: refs.Motions
        ? Object.fromEntries(
            Object.entries(refs.Motions).map(([group, motions]) => [
              group,
              motions.map((motion) => ({
                ...motion,
                File: rewriteLocalResource(fileUrls, modelDir, motion.File),
              })),
            ])
          )
        : refs.Motions,
    },
  };
}

function parsePositionSyncGroups(
  text: string,
  options: ModelOption[]
) {
  return text
    .split(/[\n,;]+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) =>
      line
        .split(/=>|=/)
        .map((token) => token.trim())
        .filter(Boolean)
        .map((token) => resolveModelUrl(token, options[0]?.url ?? "", options))
    )
    .map((urls) => Array.from(new Set(urls)))
    .filter((urls) => urls.length > 1);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function createWildcardMatcher(pattern: string) {
  if (!pattern.includes("*")) return null;

  const parts = pattern.split("*");
  return new RegExp(`^${parts.map(escapeRegExp).join("(.*)")}$`);
}

function applyWildcardCaptures(pattern: string, captures: string[]) {
  let captureIndex = 0;

  return pattern.replace(/\*/g, () => captures[captureIndex++] ?? "");
}

function resolveParameterMappings(
  defaultSourceUrl: string,
  defaultTargetUrl: string,
  parametersByUrl: Record<string, Live2DParameter[]>,
  options: ModelOption[],
  mappingRules: ParameterMappingRule[]
) {
  const mappings: ResolvedParameterMapping[] = [];
  const defaultSourceParameters = parametersByUrl[defaultSourceUrl] ?? [];
  const defaultTargetParameters = parametersByUrl[defaultTargetUrl] ?? [];
  const defaultTargetIds = new Set(
    defaultTargetParameters.map((parameter) => parameter.id)
  );

  defaultSourceParameters.forEach((parameter) => {
    if (defaultTargetIds.has(parameter.id)) {
      mappings.push({
        sourceUrl: defaultSourceUrl,
        sourceId: parameter.id,
        targetUrl: defaultTargetUrl,
        targetId: parameter.id,
      });
    }
  });

  mappingRules.forEach(
    ({ sourceModel, sourcePattern, targetModel, targetPattern }) => {
    const sourceUrl = resolveModelUrl(sourceModel, defaultSourceUrl, options);
    const targetUrl = resolveModelUrl(targetModel, defaultTargetUrl, options);
    const sourceParameters = parametersByUrl[sourceUrl] ?? [];
    const targetParameters = parametersByUrl[targetUrl] ?? [];
    const targetIds = new Set(targetParameters.map((parameter) => parameter.id));
    const sourceMatcher = createWildcardMatcher(sourcePattern);

    if (!sourceMatcher) {
      if (targetIds.has(targetPattern)) {
        mappings.push({
          sourceUrl,
          sourceId: sourcePattern,
          targetUrl,
          targetId: targetPattern,
        });
      }
      return;
    }

    sourceParameters.forEach((parameter) => {
      const match = sourceMatcher.exec(parameter.id);
      if (!match) return;

      const targetId = applyWildcardCaptures(targetPattern, match.slice(1));
      if (!targetIds.has(targetId)) return;

      mappings.push({
        sourceUrl,
        sourceId: parameter.id,
        targetUrl,
        targetId,
      });
    });
    }
  );

  return mappings;
}

function clampParameterValue(value: number, parameter?: Live2DParameter) {
  if (!parameter) return value;

  return Math.min(
    parameter.maximumValue,
    Math.max(parameter.minimumValue, value)
  );
}

function clampViewTransform(transform: Live2DViewTransform) {
  return {
    panX: Number.isFinite(transform.panX) ? transform.panX : 0,
    panY: Number.isFinite(transform.panY) ? transform.panY : 0,
    zoom:
      Number.isFinite(transform.zoom) && transform.zoom >= 0.01
        ? transform.zoom
        : 0.01,
  };
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function hasIndexedDb() {
  return typeof indexedDB !== "undefined";
}

function supportsFileSystemAccess() {
  return Boolean(
    typeof window !== "undefined" &&
      (window as WindowWithFileSystemAccess).showDirectoryPicker
  );
}

function openLocalModelDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (!hasIndexedDb()) {
      reject(new Error("IndexedDB is not available in this browser."));
      return;
    }

    const request = indexedDB.open(
      LOCAL_MODEL_DB_NAME,
      LOCAL_MODEL_DB_VERSION
    );

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(LOCAL_MODEL_STORE_NAME)) {
        db.createObjectStore(LOCAL_MODEL_STORE_NAME, { keyPath: "id" });
      }
    };
    request.onerror = () =>
      reject(request.error ?? new Error("Unable to open local model cache."));
    request.onsuccess = () => resolve(request.result);
  });
}

function idbRequest<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onerror = () =>
      reject(request.error ?? new Error("Local model cache request failed."));
    request.onsuccess = () => resolve(request.result);
  });
}

async function readCachedLocalDirectories() {
  const db = await openLocalModelDb();

  try {
    const transaction = db.transaction(LOCAL_MODEL_STORE_NAME, "readonly");
    return await idbRequest<CachedLocalDirectory[]>(
      transaction.objectStore(LOCAL_MODEL_STORE_NAME).getAll()
    );
  } finally {
    db.close();
  }
}

async function saveCachedLocalDirectory(directory: CachedLocalDirectory) {
  const db = await openLocalModelDb();

  try {
    const transaction = db.transaction(LOCAL_MODEL_STORE_NAME, "readwrite");
    await idbRequest(
      transaction.objectStore(LOCAL_MODEL_STORE_NAME).put(directory)
    );
  } finally {
    db.close();
  }
}

async function deleteCachedLocalDirectory(id: string) {
  const db = await openLocalModelDb();

  try {
    const transaction = db.transaction(LOCAL_MODEL_STORE_NAME, "readwrite");
    await idbRequest(transaction.objectStore(LOCAL_MODEL_STORE_NAME).delete(id));
  } finally {
    db.close();
  }
}

async function clearCachedLocalDirectories() {
  const db = await openLocalModelDb();

  try {
    const transaction = db.transaction(LOCAL_MODEL_STORE_NAME, "readwrite");
    await idbRequest(transaction.objectStore(LOCAL_MODEL_STORE_NAME).clear());
  } finally {
    db.close();
  }
}

async function ensureDirectoryReadPermission(
  handle: LocalDirectoryHandle,
  requestPermission: boolean
) {
  const options = { mode: "read" as const };
  const currentPermission = await handle.queryPermission?.(options);

  if (currentPermission === "granted") return true;
  if (!requestPermission) return false;

  return (await handle.requestPermission?.(options)) === "granted";
}

async function readDirectoryFiles(
  handle: LocalDirectoryHandle,
  basePath = handle.name
): Promise<LocalFileEntry[]> {
  const entries: LocalFileEntry[] = [];

  for await (const [name, childHandle] of handle.entries()) {
    const path = normalizeLocalPath(`${basePath}/${name}`);

    if (childHandle.kind === "file") {
      entries.push({ file: await childHandle.getFile(), path });
      continue;
    }

    entries.push(...(await readDirectoryFiles(childHandle, path)));
  }

  return entries;
}

function createParameterSyncRule(
  id: string,
  sourceUrl: string,
  targetUrl: string
): ParameterSyncRule {
  return {
    id,
    enabled: false,
    sourceUrl,
    targetUrl,
    mappingsText: "",
  };
}

interface ParameterControlProps {
  parameter: Live2DParameter;
  liveValue?: number;
  parameterValuesRef: React.MutableRefObject<Record<string, number>>;
  resetVersion: number;
}

const ParameterControl = memo(function ParameterControl({
  parameter,
  liveValue,
  parameterValuesRef,
  resetVersion,
}: ParameterControlProps) {
  const [value, setValue] = useState(parameter.defaultValue);
  const [isOverridden, setIsOverridden] = useState(false);
  const step =
    parameter.maximumValue - parameter.minimumValue <= 2 ? 0.01 : 0.1;

  useEffect(() => {
    setValue(parameter.defaultValue);
    setIsOverridden(false);
  }, [parameter, parameterValuesRef, resetVersion]);

  useEffect(() => {
    if (isOverridden || liveValue === undefined) return;

    setValue(liveValue);
  }, [isOverridden, liveValue]);

  const updateValue = (nextValue: number) => {
    if (!Number.isFinite(nextValue)) return;

    const clampedValue = clampParameterValue(nextValue, parameter);
    parameterValuesRef.current[parameter.id] = clampedValue;
    setIsOverridden(true);
    setValue(clampedValue);
  };
  const resetValue = () => {
    delete parameterValuesRef.current[parameter.id];
    setIsOverridden(false);
    setValue(liveValue ?? parameter.defaultValue);
  };

  return (
    <div className="parameter-control">
      <div className="parameter-topline">
        <button
          className="parameter-id"
          type="button"
          title="Reset parameter"
          onClick={resetValue}
        >
          <span className="parameter-name">
            {parameter.name ?? parameter.id}
          </span>
          {parameter.name ? (
            <span className="parameter-id-text">{parameter.id}</span>
          ) : null}
        </button>
        <output>
          {isOverridden ? "Override " : "Live "}
          {value.toFixed(2)}
        </output>
      </div>
      <div className="parameter-value-control">
        <input
          aria-label={parameter.id}
          max={parameter.maximumValue}
          min={parameter.minimumValue}
          onChange={(event) => updateValue(Number(event.target.value))}
          step={step}
          type="range"
          value={value}
        />
        <input
          aria-label={`${parameter.id} value`}
          className="number-input"
          max={parameter.maximumValue}
          min={parameter.minimumValue}
          onChange={(event) => updateValue(Number(event.target.value))}
          step={step}
          type="number"
          value={value}
        />
      </div>
      <div className="parameter-range">
        <span>{parameter.minimumValue.toFixed(1)}</span>
        <span>{parameter.defaultValue.toFixed(1)}</span>
        <span>{parameter.maximumValue.toFixed(1)}</span>
      </div>
    </div>
  );
});

export function Live2DViewerClient({
  modelUrl,
  models = [],
  width = 400,
  height = 600,
}: Props) {
  const catalogOptions = useMemo<ModelOption[]>(
    () =>
      models.length > 0
        ? models
        : [{ label: modelUrl, url: modelUrl, source: "models" }],
    [modelUrl, models]
  );
  const [localModels, setLocalModels] = useState<LocalModelOption[]>([]);
  const [localOpenStatus, setLocalOpenStatus] = useState("");
  const [modelSearch, setModelSearch] = useState("");
  const [enabledModelSources, setEnabledModelSources] = useState<
    Record<ModelSource, boolean>
  >({
    local: true,
    models: true,
    samples: true,
  });
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const options = useMemo<ModelOption[]>(
    () => [...catalogOptions, ...localModels],
    [catalogOptions, localModels]
  );
  const [selectedUrl, setSelectedUrl] = useState(modelUrl);
  const [loadedUrls, setLoadedUrls] = useState<Set<string>>(() => new Set());
  const [visibleUrls, setVisibleUrls] = useState<Set<string>>(() => new Set());
  const [layerOrder, setLayerOrder] = useState<string[]>(() =>
    options.map((model) => model.url)
  );
  const [draggedLayerUrl, setDraggedLayerUrl] = useState<string | null>(null);
  const [dragOverLayerUrl, setDragOverLayerUrl] = useState<string | null>(null);
  const [parametersByUrl, setParametersByUrl] = useState<
    Record<string, Live2DParameter[]>
  >({});
  const [liveParameterValuesByUrl, setLiveParameterValuesByUrl] = useState<
    Record<string, Record<string, number>>
  >({});
  const [motionsByUrl, setMotionsByUrl] = useState<
    Record<string, Live2DMotionOption[]>
  >({});
  const [expressionsByUrl, setExpressionsByUrl] = useState<
    Record<string, Live2DExpressionOption[]>
  >({});
  const [modelDiagnosticsByUrl, setModelDiagnosticsByUrl] = useState<
    Record<string, Live2DModelDiagnostics>
  >({});
  const [motionRequestByUrl, setMotionRequestByUrl] = useState<
    Record<string, Live2DMotionRequest | null>
  >({});
  const [expressionRequestByUrl, setExpressionRequestByUrl] = useState<
    Record<string, Live2DExpressionRequest | null>
  >({});
  const [parameterFilter, setParameterFilter] = useState("");
  const [parameterUpdateFps, setParameterUpdateFps] = useState(10);
  const [viewTransformsByUrl, setViewTransformsByUrl] = useState<
    Record<string, Live2DViewTransform>
  >({});
  const [positionSync, setPositionSync] = useState<PositionSyncState>(() => ({
    enabled: false,
    expressionText: "",
  }));
  const [layerRenderSettingsByUrl, setLayerRenderSettingsByUrl] = useState<
    Record<string, LayerRenderSettings>
  >({});
  const [effectSettingsByUrl, setEffectSettingsByUrl] = useState<
    Record<string, Required<Live2DEffectSettings>>
  >({});
  const [parameterSyncRules, setParameterSyncRules] = useState<
    ParameterSyncRule[]
  >(() => [
    createParameterSyncRule(
      "sync-1",
      modelUrl,
      models.find((model) => model.url !== modelUrl)?.url ?? modelUrl
    ),
  ]);
  const [expandedCards, setExpandedCards] = useState({
    parameterSync: true,
    positionSync: true,
    layer: true,
    effects: true,
    parameters: true,
    motions: true,
    expressions: true,
    position: true,
  });
  const [visibleCards, setVisibleCards] = useState<
    Record<InspectorCardId, boolean>
  >({
    parameterSync: true,
    positionSync: true,
    layer: true,
    effects: true,
    parameters: true,
    motions: true,
    expressions: true,
    position: true,
  });
  const [resetVersion, setResetVersion] = useState(0);
  const [inspectorWidth, setInspectorWidth] = useState(
    DEFAULT_INSPECTOR_WIDTH
  );
  const [activeInspectorPanel, setActiveInspectorPanel] =
    useState<InspectorPanelId>("globalSync");
  const parameterValuesRefs = useRef<
    Record<string, React.MutableRefObject<Record<string, number>>>
  >({});
  const viewTransformRefs = useRef<
    Record<string, React.MutableRefObject<Live2DViewTransform>>
  >({});
  const lastSyncedParametersRef = useRef<Record<string, SyncedParameters[]>>({});
  const localModelsRef = useRef<LocalModelOption[]>([]);
  const restoredLocalCacheRef = useRef(false);
  const selectedModel =
    options.find((model) => model.url === selectedUrl) ?? options[0];
  const selectedParameterValuesRef =
    parameterValuesRefs.current[selectedUrl] ??
    ({ current: {} } as React.MutableRefObject<Record<string, number>>);
  const parameters = parametersByUrl[selectedUrl] ?? [];
  const liveParameterValues = liveParameterValuesByUrl[selectedUrl] ?? {};
  const selectedViewTransform =
    viewTransformsByUrl[selectedUrl] ?? DEFAULT_VIEW_TRANSFORM;
  const selectedLayerRenderSettings = getLayerRenderSettings(selectedUrl);
  const selectedEffectSettings = getEffectSettings(selectedUrl);
  const motions = motionsByUrl[selectedUrl] ?? [];
  const expressions = expressionsByUrl[selectedUrl] ?? [];
  const modelsByUrl = useMemo(
    () => new Map(options.map((model) => [model.url, model])),
    [options]
  );
  const orderedOptions = layerOrder
    .map((url) => modelsByUrl.get(url))
    .filter((model): model is ModelOption => Boolean(model));
  const filteredOptions = useMemo(() => {
    const query = modelSearch.trim().toLowerCase();

    return orderedOptions.filter((model) => {
      if (!enabledModelSources[model.source]) return false;
      if (!query) return true;

      return model.label.toLowerCase().includes(query);
    });
  }, [enabledModelSources, modelSearch, orderedOptions]);
  const displayOptions = [...filteredOptions].reverse();
  const loadedModels = orderedOptions.filter((model) =>
    loadedUrls.has(model.url)
  );
  const displayLoadedModels = [...loadedModels].reverse();
  const visibleLoadedModels = loadedModels.filter((model) =>
    visibleUrls.has(model.url)
  );
  const diagnosticsModel = modelsByUrl.get(selectedUrl);
  const selectedModelDiagnostics =
    diagnosticsModel && loadedUrls.has(diagnosticsModel.url)
      ? modelDiagnosticsByUrl[diagnosticsModel.url]
      : undefined;
  const selectedModelDiagnosticStatus = diagnosticsModel
    ? loadedUrls.has(diagnosticsModel.url)
      ? "waiting"
      : "not loaded"
    : "no model selected";
  const modelCounts = options.reduce(
    (counts, model) => ({
      ...counts,
      [model.source]: counts[model.source] + 1,
    }),
    { local: 0, models: 0, samples: 0 }
  );
  const filteredParameters = useMemo(() => {
    const query = parameterFilter.trim().toLowerCase();
    if (!query) return parameters;

    return parameters.filter((parameter) =>
      `${parameter.id} ${parameter.name ?? ""}`.toLowerCase().includes(query)
    );
  }, [parameterFilter, parameters]);
  const syncRuleSummaries = useMemo(
    () =>
      parameterSyncRules.map((rule) => {
        const mappings = resolveParameterMappings(
          rule.sourceUrl,
          rule.targetUrl,
          parametersByUrl,
          options,
          parseParameterMappings(rule.mappingsText)
        );

        const activeMappingCount = mappings.filter(
          (mapping) =>
            liveParameterValuesByUrl[mapping.sourceUrl]?.[mapping.sourceId] !==
              undefined &&
            (parametersByUrl[mapping.targetUrl] ?? []).some(
              (parameter) => parameter.id === mapping.targetId
            )
        ).length;

        return {
          ...rule,
          activeMappingCount,
          mappings,
          sourceLabel: modelsByUrl.get(rule.sourceUrl)?.label ?? "source",
          targetLabel: modelsByUrl.get(rule.targetUrl)?.label ?? "target",
        };
      }),
    [
      liveParameterValuesByUrl,
      modelsByUrl,
      options,
      parameterSyncRules,
      parametersByUrl,
    ]
  );
  const positionSyncGroups = useMemo(
    () =>
      parsePositionSyncGroups(
        positionSync.expressionText,
        options
      ),
    [options, positionSync.expressionText]
  );
  const positionSyncSourceByUrl = useMemo(() => {
    const sources = new Map<string, string>();
    if (!positionSync.enabled) return sources;

    positionSyncGroups.forEach(([sourceUrl, ...targetUrls]) => {
      targetUrls.forEach((targetUrl) => {
        sources.set(targetUrl, sourceUrl);
      });
    });

    return sources;
  }, [positionSync.enabled, positionSyncGroups]);

  useEffect(() => {
    localModelsRef.current = localModels;
  }, [localModels]);

  useEffect(
    () => () => {
      localModelsRef.current.forEach((model) => {
        model.objectUrls.forEach((url) => URL.revokeObjectURL(url));
      });
    },
    []
  );

  useEffect(() => {
    folderInputRef.current?.setAttribute("webkitdirectory", "");
    folderInputRef.current?.setAttribute("directory", "");
  }, []);

  useEffect(() => {
    if (restoredLocalCacheRef.current) return;
    restoredLocalCacheRef.current = true;
    void restoreCachedLocalModels(false);
  }, []);

  useEffect(() => {
    const validUrls = new Set(options.map((model) => model.url));
    setLoadedUrls((current) => {
      return new Set(Array.from(current).filter((url) => validUrls.has(url)));
    });
    setVisibleUrls((current) => {
      return new Set(
        Array.from(current).filter((url) => validUrls.has(url))
      );
    });
    if (!validUrls.has(selectedUrl) && options[0]) {
      setSelectedUrl(options[0].url);
    }
    setLayerOrder((current) => {
      const currentUrls = current.filter((url) => validUrls.has(url));
      const knownUrls = new Set(currentUrls);
      const addedUrls = options
        .map((model) => model.url)
        .filter((url) => !knownUrls.has(url));

      return [...currentUrls, ...addedUrls];
    });
    setParameterSyncRules((current) =>
      current.map((rule) => {
        const fallbackSource = validUrls.has(rule.sourceUrl)
          ? rule.sourceUrl
          : options[0]?.url ?? "";
        const fallbackTarget = validUrls.has(rule.targetUrl)
          ? rule.targetUrl
          : options.find((model) => model.url !== fallbackSource)?.url ??
            fallbackSource;

        return {
          ...rule,
          sourceUrl: fallbackSource,
          targetUrl: fallbackTarget,
        };
      })
    );
    setViewTransformsByUrl((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([url]) => validUrls.has(url))
      )
    );
    setLayerRenderSettingsByUrl((current) =>
      Object.fromEntries(
        Object.entries(current)
          .filter(([url]) => validUrls.has(url))
          .map(([url, settings]) => [
            url,
            {
              ...settings,
              clipToModelUrl: validUrls.has(settings.clipToModelUrl)
                ? settings.clipToModelUrl
                : "",
            },
          ])
      )
    );
    setEffectSettingsByUrl((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([url]) => validUrls.has(url))
      )
    );
    setModelDiagnosticsByUrl((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([url]) => validUrls.has(url))
      )
    );
  }, [options, selectedUrl]);

  const getParameterValuesRef = (url: string) => {
    parameterValuesRefs.current[url] ??= { current: {} };
    return parameterValuesRefs.current[url];
  };
  const getOwnViewTransformRef = (url: string) => {
    viewTransformRefs.current[url] ??= {
      current: viewTransformsByUrl[url] ?? DEFAULT_VIEW_TRANSFORM,
    };
    return viewTransformRefs.current[url];
  };
  const getViewTransformRef = (url: string) => {
    const sourceUrl = positionSyncSourceByUrl.get(url);

    return getOwnViewTransformRef(sourceUrl ?? url);
  };
  const selectModel = (url: string) => {
    setSelectedUrl(url);
    setParameterFilter("");
  };
  const loadModel = (url: string, show = true) => {
    setLoadedUrls((current) => new Set(current).add(url));
    if (show) setVisibleUrls((current) => new Set(current).add(url));
  };
  const importLocalFileEntries = async (
    entries: LocalFileEntry[],
    options: { cacheId?: string; statusPrefix?: string } = {}
  ) => {
    if (entries.length === 0) {
      setLocalOpenStatus("No files selected.");
      return 0;
    }

    const modelEntries = entries.filter((entry) =>
      entry.file.name.toLowerCase().endsWith(".model3.json")
    );
    if (modelEntries.length === 0) {
      setLocalOpenStatus("No .model3.json file found in that selection.");
      return 0;
    }

    const hasDirectoryPaths = entries.some((entry) => entry.path.includes("/"));
    if (!hasDirectoryPaths && entries.length === modelEntries.length) {
      setLocalOpenStatus(
        "Files mode needs .model3.json plus its .moc3, textures, and optional motion/expression files selected together. Use Open folder for one-click import."
      );
      return 0;
    }

    const importedModels: LocalModelOption[] = [];
    const createdUrls: string[] = [];

    try {
      for (const modelEntry of modelEntries) {
        const fileUrls = new Map<string, string>();
        const objectUrls: string[] = [];

        entries.forEach((entry) => {
          const url = URL.createObjectURL(entry.file);
          const path = normalizeLocalPath(entry.path);
          fileUrls.set(path, url);
          objectUrls.push(url);
          createdUrls.push(url);
        });

        const modelPath = normalizeLocalPath(modelEntry.path);
        const settings = JSON.parse(
          await modelEntry.file.text()
        ) as LocalModelSettings;
        const rewrittenSettings = rewriteLocalModelSettings(
          settings,
          fileUrls,
          dirname(modelPath)
        );
        const modelSettingsUrl = URL.createObjectURL(
          new Blob([JSON.stringify(rewrittenSettings)], {
            type: "application/json",
          })
        );
        objectUrls.push(modelSettingsUrl);
        createdUrls.push(modelSettingsUrl);

        importedModels.push({
          label: `Local: ${modelEntry.file.name.replace(
            /\.model3\.json$/i,
            ""
          )}`,
          source: "local",
          url: modelSettingsUrl,
          objectUrls,
          cacheId: options.cacheId,
        });
      }
    } catch (error) {
      createdUrls.forEach((url) => URL.revokeObjectURL(url));
      setLocalOpenStatus(
        error instanceof Error
          ? `Unable to open local model: ${error.message}`
          : "Unable to open local model."
      );
      return 0;
    }

    setLocalModels((current) => [...current, ...importedModels]);
    setSelectedUrl(importedModels[0].url);
    importedModels.forEach((model) => loadModel(model.url));
    setLocalOpenStatus(
      `${options.statusPrefix ?? ""}${importedModels.length} local model${
        importedModels.length === 1 ? "" : "s"
      } ready.`
    );
    return importedModels.length;
  };
  const openLocalDirectory = async () => {
    const picker = (window as WindowWithFileSystemAccess).showDirectoryPicker;

    if (!picker) {
      folderInputRef.current?.click();
      return;
    }

    try {
      const handle = await picker.call(window);
      const id = `${handle.name}-${Date.now()}`;
      const importedCount = await importLocalFileEntries(
        await readDirectoryFiles(handle),
        {
          cacheId: id,
          statusPrefix: "Cached ",
        }
      );
      if (importedCount > 0) {
        await saveCachedLocalDirectory({ id, name: handle.name, handle });
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setLocalOpenStatus("Folder selection cancelled.");
        return;
      }

      setLocalOpenStatus(
        error instanceof Error
          ? `Unable to open folder: ${error.message}`
          : "Unable to open folder."
      );
    }
  };
  const restoreCachedLocalModels = async (requestPermission = false) => {
    if (!supportsFileSystemAccess()) {
      setLocalOpenStatus("File System Access API is not available here.");
      return;
    }

    try {
      const cachedDirectories = await readCachedLocalDirectories();
      const unloadedDirectories = cachedDirectories.filter(
        (directory) =>
          !localModelsRef.current.some(
            (localModel) => localModel.cacheId === directory.id
          )
      );

      if (unloadedDirectories.length === 0) {
        setLocalOpenStatus("No cached local folders to restore.");
        return;
      }

      let restoredModels = 0;
      let blockedDirectories = 0;

      for (const directory of unloadedDirectories) {
        const hasPermission = await ensureDirectoryReadPermission(
          directory.handle,
          requestPermission
        );

        if (!hasPermission) {
          blockedDirectories += 1;
          continue;
        }

        restoredModels += await importLocalFileEntries(
          await readDirectoryFiles(directory.handle),
          {
            cacheId: directory.id,
            statusPrefix: "Restored cached ",
          }
        );
      }

      if (blockedDirectories > 0) {
        setLocalOpenStatus(
          requestPermission
            ? "Cached folder permission was not granted."
            : "Cached folder needs permission. Click Restore cached."
        );
        return;
      }

      if (restoredModels === 0) {
        setLocalOpenStatus("No cached local models were restored.");
      }
    } catch (error) {
      setLocalOpenStatus(
        error instanceof Error
          ? `Unable to restore cached models: ${error.message}`
          : "Unable to restore cached models."
      );
    }
  };
  const clearLocalModels = async () => {
    const localUrls = new Set(localModels.map((model) => model.url));

    localModels.forEach((model) => {
      model.objectUrls.forEach((url) => URL.revokeObjectURL(url));
    });
    setLocalModels([]);
    setLoadedUrls((current) => {
      const next = new Set(current);
      localUrls.forEach((url) => next.delete(url));
      return next;
    });
    setVisibleUrls((current) => {
      const next = new Set(current);
      localUrls.forEach((url) => next.delete(url));
      return next;
    });
    setLocalOpenStatus("");
    if (localUrls.has(selectedUrl)) {
      setSelectedUrl(catalogOptions[0]?.url ?? modelUrl);
    }
    try {
      await clearCachedLocalDirectories();
    } catch {
      setLocalOpenStatus("Local models cleared, but cached folder handles remain.");
    }
  };
  const removeLocalModel = async (url: string) => {
    const model = localModels.find((localModel) => localModel.url === url);
    if (!model) return;
    const cacheId = model.cacheId;
    const removedCacheGroup = cacheId
      ? localModels.filter((localModel) => localModel.cacheId === cacheId)
      : [model];
    const removedUrls = new Set(
      removedCacheGroup.map((localModel) => localModel.url)
    );

    removedCacheGroup.forEach((localModel) => {
      localModel.objectUrls.forEach((objectUrl) => URL.revokeObjectURL(objectUrl));
    });
    setLocalModels((current) =>
      current.filter((localModel) => !removedUrls.has(localModel.url))
    );
    setLoadedUrls((current) => {
      const next = new Set(current);
      removedUrls.forEach((removedUrl) => next.delete(removedUrl));
      return next;
    });
    setVisibleUrls((current) => {
      const next = new Set(current);
      removedUrls.forEach((removedUrl) => next.delete(removedUrl));
      return next;
    });
    setLocalOpenStatus(
      cacheId
        ? `Removed cached folder for ${model.label}.`
        : `Removed ${model.label}.`
    );

    if (removedUrls.has(selectedUrl)) {
      const fallbackModel =
        options.find((option) => !removedUrls.has(option.url)) ??
        catalogOptions[0];
      setSelectedUrl(fallbackModel?.url ?? modelUrl);
    }

    if (cacheId) {
      try {
        await deleteCachedLocalDirectory(cacheId);
      } catch {
        setLocalOpenStatus(
          `Removed ${model.label}, but its cached folder handle remains.`
        );
      }
    }
  };
  const handleOpenLocalModels = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const selectedFiles = Array.from(event.target.files ?? []).map((file) => ({
      file,
      path: normalizeLocalPath(file.webkitRelativePath || file.name),
    }));
    event.target.value = "";
    await importLocalFileEntries(selectedFiles);
  };
  const unloadModel = (url: string) => {
    setLoadedUrls((current) => {
      const next = new Set(current);
      next.delete(url);
      return next;
    });
    setVisibleUrls((current) => {
      const next = new Set(current);
      next.delete(url);
      return next;
    });
  };
  const toggleModelVisibility = (url: string) => {
    selectModel(url);
    loadModel(url, false);
    setVisibleUrls((current) => {
      const next = new Set(current);
      if (next.has(url)) {
        next.delete(url);
      } else {
        next.add(url);
      }
      return next;
    });
  };
  const loadAllModels = () => {
    const urls = filteredOptions.map((model) => model.url);
    setLoadedUrls(new Set(urls));
    setVisibleUrls(new Set(urls));
  };
  const toggleModelSource = (source: ModelSource) => {
    setEnabledModelSources((current) => ({
      ...current,
      [source]: !current[source],
    }));
  };
  const moveLayer = (url: string, direction: "up" | "down") => {
    setLayerOrder((current) => {
      const next = [...current];
      const loadedOrder = next.filter((layerUrl) => loadedUrls.has(layerUrl));
      const loadedIndex = loadedOrder.indexOf(url);
      const targetLoadedIndex =
        direction === "up" ? loadedIndex + 1 : loadedIndex - 1;
      const targetUrl = loadedOrder[targetLoadedIndex];

      if (loadedIndex === -1 || targetUrl === undefined) return current;

      const index = next.indexOf(url);
      const targetIndex = next.indexOf(targetUrl);
      next[index] = targetUrl;
      next[targetIndex] = url;
      return next;
    });
  };
  const moveDisplayLayer = (
    dragUrl: string,
    targetUrl: string,
    placement: "before" | "after"
  ) => {
    if (dragUrl === targetUrl) return;

    setLayerOrder((current) => {
      const displayOrder = [...current].reverse();
      const nextDisplayOrder = displayOrder.filter((url) => url !== dragUrl);
      const targetIndex = nextDisplayOrder.indexOf(targetUrl);

      if (targetIndex === -1) return current;

      nextDisplayOrder.splice(
        placement === "before" ? targetIndex : targetIndex + 1,
        0,
        dragUrl
      );
      return nextDisplayOrder.reverse();
    });
  };
  const handleParametersLoaded = useCallback(
    (url: string, loadedParameters: Live2DParameter[]) => {
      setParametersByUrl((current) => ({
        ...current,
        [url]: loadedParameters,
      }));
      setLiveParameterValuesByUrl((current) => ({
        ...current,
        [url]: Object.fromEntries(
          loadedParameters.map((parameter) => [parameter.id, parameter.value])
        ),
      }));
      getParameterValuesRef(url).current = {};
      if (url === selectedUrl) {
        setParameterFilter("");
        setResetVersion((current) => current + 1);
      }
    },
    [selectedUrl]
  );
  const resetAllParameters = () => {
    getParameterValuesRef(selectedUrl).current = {};
    setResetVersion((current) => current + 1);
  };
  const updateViewTransform = (
    url: string,
    transform: Live2DViewTransform
  ) => {
    const nextTransform = clampViewTransform(transform);
    const nextTransforms: Record<string, Live2DViewTransform> = {
      [url]: nextTransform,
    };

    getOwnViewTransformRef(url).current = nextTransform;

    if (positionSync.enabled) {
      positionSyncGroups.forEach(([sourceUrl, ...targetUrls]) => {
        if (sourceUrl !== url) return;

        targetUrls.forEach((targetUrl) => {
          getOwnViewTransformRef(targetUrl).current = nextTransform;
          nextTransforms[targetUrl] = nextTransform;
        });
      });
    }

    setViewTransformsByUrl((current) => ({
      ...current,
      ...nextTransforms,
    }));
  };
  const updateSelectedViewTransform = (
    patch: Partial<Live2DViewTransform>
  ) => {
    updateViewTransform(selectedUrl, {
      ...selectedViewTransform,
      ...patch,
    });
  };
  const resetSelectedViewTransform = () => {
    updateViewTransform(selectedUrl, DEFAULT_VIEW_TRANSFORM);
  };
  function getLayerRenderSettings(url: string): LayerRenderSettings {
    return layerRenderSettingsByUrl[url] ?? {
      blendMode: "normal",
      clipToModelUrl: "",
    };
  }
  const updateLayerRenderSettings = (
    url: string,
    patch: Partial<LayerRenderSettings>
  ) => {
    setLayerRenderSettingsByUrl((current) => ({
      ...current,
      [url]: {
        ...(current[url] ?? { blendMode: "normal", clipToModelUrl: "" }),
        ...patch,
      },
    }));
  };
  function getEffectSettings(url: string): Required<Live2DEffectSettings> {
    return {
      ...DEFAULT_EFFECT_SETTINGS,
      ...effectSettingsByUrl[url],
    };
  }
  const updateEffectSettings = (
    url: string,
    patch: Partial<Live2DEffectSettings>
  ) => {
    setEffectSettingsByUrl((current) => ({
      ...current,
      [url]: {
        ...DEFAULT_EFFECT_SETTINGS,
        ...current[url],
        ...patch,
      },
    }));
  };
  const clearLastSyncedParameters = useCallback(() => {
    Object.values(lastSyncedParametersRef.current).forEach((ruleTargets) => {
      ruleTargets.forEach((lastSynced) => {
        const targetRef = getParameterValuesRef(lastSynced.targetUrl);
        lastSynced.parameterIds.forEach((parameterId) => {
          delete targetRef.current[parameterId];
        });
      });
    });
    lastSyncedParametersRef.current = {};
  }, []);
  const updateSyncRule = (id: string, patch: Partial<ParameterSyncRule>) => {
    setParameterSyncRules((current) =>
      current.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule))
    );
  };
  const addSyncRule = () => {
    const sourceUrl = selectedUrl || options[0]?.url || "";
    const targetUrl =
      options.find((model) => model.url !== sourceUrl)?.url ?? sourceUrl;

    setParameterSyncRules((current) => [
      ...current,
      createParameterSyncRule(`sync-${Date.now()}`, sourceUrl, targetUrl),
    ]);
  };
  const removeSyncRule = (id: string) => {
    setParameterSyncRules((current) =>
      current.length === 1 ? current : current.filter((rule) => rule.id !== id)
    );
  };
  const toggleCard = (card: InspectorCardId) => {
    setExpandedCards((current) => ({
      ...current,
      [card]: !current[card],
    }));
  };
  const toggleVisibleCard = (card: InspectorCardId) => {
    setVisibleCards((current) => ({
      ...current,
      [card]: !current[card],
    }));
  };
  const requestMotion = (motion: Live2DMotionOption) => {
    setMotionRequestByUrl((current) => ({
      ...current,
      [selectedUrl]: {
        group: motion.group,
        index: motion.index,
        nonce: Date.now(),
      },
    }));
  };
  const requestExpression = (expression: Live2DExpressionOption) => {
    setExpressionRequestByUrl((current) => ({
      ...current,
      [selectedUrl]: {
        index: expression.index,
        nonce: Date.now(),
      },
    }));
  };
  const startInspectorResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();

    const updateWidth = (clientX: number) => {
      setInspectorWidth(
        clampNumber(
          window.innerWidth - clientX,
          MIN_INSPECTOR_WIDTH,
          MAX_INSPECTOR_WIDTH
        )
      );
    };
    const handlePointerMove = (moveEvent: PointerEvent) => {
      updateWidth(moveEvent.clientX);
    };
    const handlePointerUp = () => {
      document.body.classList.remove("is-resizing-inspector");
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };

    document.body.classList.add("is-resizing-inspector");
    updateWidth(event.clientX);
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
  };

  useEffect(() => {
    clearLastSyncedParameters();

    syncRuleSummaries.forEach((rule) => {
      if (
        !rule.enabled ||
        !rule.sourceUrl ||
        !rule.targetUrl
      ) {
        return;
      }

      const sourceValues = liveParameterValuesByUrl[rule.sourceUrl];
      const syncedParametersByTarget = new Map<string, string[]>();

      rule.mappings.forEach((mapping) => {
        const value =
          liveParameterValuesByUrl[mapping.sourceUrl]?.[mapping.sourceId] ??
          sourceValues?.[mapping.sourceId];
        const targetParameter = (parametersByUrl[mapping.targetUrl] ?? []).find(
          (parameter) => parameter.id === mapping.targetId
        );
        if (value === undefined || !targetParameter) return;

        const targetRef = getParameterValuesRef(mapping.targetUrl);
        targetRef.current[mapping.targetId] = clampParameterValue(
          value,
          targetParameter
        );
        const syncedParameterIds =
          syncedParametersByTarget.get(mapping.targetUrl) ?? [];
        syncedParameterIds.push(mapping.targetId);
        syncedParametersByTarget.set(mapping.targetUrl, syncedParameterIds);
      });

      lastSyncedParametersRef.current[rule.id] = Array.from(
        syncedParametersByTarget.entries()
      ).map(([targetUrl, parameterIds]) => ({
        targetUrl,
        parameterIds,
      }));
    });
  }, [
    clearLastSyncedParameters,
    liveParameterValuesByUrl,
    parametersByUrl,
    syncRuleSummaries,
  ]);

  useEffect(() => {
    if (!positionSync.enabled || positionSyncGroups.length === 0) {
      return;
    }

    const nextTransforms = { ...viewTransformsByUrl };
    let changed = false;

    positionSyncGroups.forEach(([sourceUrl, ...targetUrls]) => {
      const sourceTransform =
        nextTransforms[sourceUrl] ?? DEFAULT_VIEW_TRANSFORM;

      targetUrls.forEach((targetUrl) => {
        const targetTransform =
          nextTransforms[targetUrl] ?? DEFAULT_VIEW_TRANSFORM;
        if (
          sourceTransform.panX === targetTransform.panX &&
          sourceTransform.panY === targetTransform.panY &&
          sourceTransform.zoom === targetTransform.zoom
        ) {
          return;
        }

        nextTransforms[targetUrl] = sourceTransform;
        changed = true;
      });
    });

    if (changed) {
      Object.entries(nextTransforms).forEach(([url, transform]) => {
        getOwnViewTransformRef(url).current = transform;
      });
      setViewTransformsByUrl(nextTransforms);
    }
  }, [positionSync.enabled, positionSyncGroups, viewTransformsByUrl]);

  return (
    <section
      className="workspace"
      style={
        { "--inspector-width": `${inspectorWidth}px` } as React.CSSProperties
      }
    >
      <aside className="sidebar">
        <div className="sidebar-header">
          <div>
            <p className="eyebrow">Cubism Viewer</p>
            <h1>Live2D Studio</h1>
          </div>
          <span className="status-dot" aria-label="Ready" />
        </div>

        <div className="local-model-import">
          <input
            ref={folderInputRef}
            type="file"
            multiple
            className="sr-only"
            onChange={handleOpenLocalModels}
          />
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".model3.json,.json,.moc3,.png,.jpg,.jpeg,.webp,.motion3.json,.exp3.json,.physics3.json,.pose3.json"
            className="sr-only"
            onChange={handleOpenLocalModels}
          />
          <button
            className="ghost-button"
            type="button"
            onClick={openLocalDirectory}
          >
            Open folder
          </button>
          <button
            className="inline-action"
            type="button"
            onClick={() => restoreCachedLocalModels(true)}
          >
            Restore cached
          </button>
          <button
            className="inline-action"
            type="button"
            onClick={() => fileInputRef.current?.click()}
          >
            Files
          </button>
          <button
            className="inline-action"
            type="button"
            disabled={localModels.length === 0}
            onClick={clearLocalModels}
          >
            Clear
          </button>
          {localOpenStatus ? (
            <p className="local-open-status">{localOpenStatus}</p>
          ) : null}
        </div>

        <div className="sidebar-section">
          <div className="section-heading">
            <span>Models</span>
            <button
              className="inline-action"
              type="button"
              onClick={loadAllModels}
              disabled={filteredOptions.length === 0}
            >
              Load all
            </button>
          </div>

          <label className="search-field model-search-field">
            <span>Search</span>
            <input
              value={modelSearch}
              onChange={(event) => setModelSearch(event.target.value)}
              placeholder="Search model name..."
              type="search"
            />
          </label>

          <div className="model-list" role="listbox" aria-label="Model list">
            {displayOptions.map((model) => {
              const isSelected = model.url === selectedUrl;
              const isLoaded = loadedUrls.has(model.url);
              const isVisible = visibleUrls.has(model.url);
              const displayLayerIndex = displayLoadedModels.findIndex(
                (loadedModel) => loadedModel.url === model.url
              );
              const canMoveUp = isLoaded && displayLayerIndex > 0;
              const canMoveDown =
                isLoaded && displayLayerIndex < displayLoadedModels.length - 1;

              return (
                <div
                  key={model.url}
                  className={`model-row${isSelected ? " selected" : ""}${
                    draggedLayerUrl === model.url ? " dragging" : ""
                  }${dragOverLayerUrl === model.url ? " drop-target" : ""}`}
                  role="option"
                  aria-selected={isSelected}
                  draggable
                  onDragStart={(event) => {
                    setDraggedLayerUrl(model.url);
                    setDragOverLayerUrl(null);
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", model.url);
                  }}
                  onDragEnd={() => {
                    setDraggedLayerUrl(null);
                    setDragOverLayerUrl(null);
                  }}
                  onDragOver={(event) => {
                    event.preventDefault();
                    if (draggedLayerUrl !== model.url) {
                      setDragOverLayerUrl(model.url);
                    }
                    event.dataTransfer.dropEffect = "move";
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    const dragUrl =
                      event.dataTransfer.getData("text/plain") ??
                      draggedLayerUrl;
                    if (dragUrl) {
                      const rect = event.currentTarget.getBoundingClientRect();
                      moveDisplayLayer(
                        dragUrl,
                        model.url,
                        event.clientY < rect.top + rect.height / 2
                          ? "before"
                          : "after"
                      );
                    }
                    setDraggedLayerUrl(null);
                    setDragOverLayerUrl(null);
                  }}
                >
                  <button
                    className="model-select-button"
                    type="button"
                    onClick={() => selectModel(model.url)}
                  >
                    <span className="model-name">{model.label}</span>
                    <span className="model-source">
                      {model.source === "local"
                        ? "Browser Local"
                        : model.source === "models"
                          ? "Custom"
                          : "SDK Sample"}
                    </span>
                  </button>
                  <div className="model-actions">
                    <div className="model-switches">
                      <button
                        className={`switch-toggle${isLoaded ? " active" : ""}`}
                        type="button"
                        role="switch"
                        aria-checked={isLoaded}
                        aria-label="Load model"
                        onClick={() => {
                          selectModel(model.url);
                          if (isLoaded) {
                            unloadModel(model.url);
                          } else {
                            loadModel(model.url);
                          }
                        }}
                      >
                        <span className="switch-track" aria-hidden="true" />
                        <span className="switch-label">&#21152;&#36733;</span>
                      </button>
                      <button
                        className={`switch-toggle${isVisible ? " active" : ""}`}
                        type="button"
                        role="switch"
                        aria-checked={isVisible}
                        disabled={!isLoaded}
                        aria-label="Show model"
                        onClick={() => toggleModelVisibility(model.url)}
                      >
                        <span className="switch-track" aria-hidden="true" />
                        <span className="switch-label">&#26174;&#31034;</span>
                      </button>
                    </div>
                    <div className="layer-actions">
                      <button
                        className="layer-button"
                        type="button"
                        disabled={!canMoveUp}
                        onClick={() => moveLayer(model.url, "up")}
                        title="Move layer up"
                        aria-label="Move layer up"
                      >
                        <span aria-hidden="true">&#8593;</span>
                      </button>
                      <button
                        className="layer-button"
                        type="button"
                        disabled={!canMoveDown}
                        onClick={() => moveLayer(model.url, "down")}
                        title="Move layer down"
                        aria-label="Move layer down"
                      >
                        <span aria-hidden="true">&#8595;</span>
                      </button>
                      {model.source === "local" ? (
                        <button
                          className="layer-button danger"
                          type="button"
                          onClick={() => removeLocalModel(model.url)}
                          title="Remove local model"
                          aria-label="Remove local model"
                        >
                          <span aria-hidden="true">&#215;</span>
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {options.length === 0 ? (
            <p className="empty-copy">
              Add .model3.json files under public/models to populate the
              sidebar.
            </p>
          ) : null}
          {options.length > 0 && displayOptions.length === 0 ? (
            <p className="empty-copy">No models match the current filters.</p>
          ) : null}
        </div>

        <div className="sidebar-footer">
          {MODEL_SOURCE_OPTIONS.map((option) => {
            const enabled = enabledModelSources[option.source];

            return (
              <button
                aria-checked={enabled}
                className={`stat-card source-toggle${
                  enabled ? " active" : ""
                }`}
                key={option.source}
                onClick={() => toggleModelSource(option.source)}
                role="switch"
                type="button"
              >
                <span>{option.label}</span>
                <strong>{modelCounts[option.source]}</strong>
              </button>
            );
          })}
        </div>
      </aside>

      <div className="stage">
        <header className="stage-toolbar">
          <div>
            <p className="eyebrow">Loaded Models</p>
            <h2>{selectedModel?.label ?? "No model found"}</h2>
          </div>
          <div className="stage-status-group">
            <div className="model-path" title={selectedUrl}>
              {visibleLoadedModels.length}/{loadedModels.length} visible
            </div>
            <details className="model-diagnostics">
              <summary
                title={
                  selectedModelDiagnostics?.hiddenMaskSourceIds.length
                    ? selectedModelDiagnostics.hiddenMaskSourceIds.join(", ")
                    : `Clipping diagnostics: ${selectedModelDiagnosticStatus}`
                }
              >
                <span>Mask</span>
                <strong>
                  {selectedModelDiagnostics
                    ? `${selectedModelDiagnostics.maskPermutationCount}/36`
                    : selectedModelDiagnosticStatus}
                </strong>
                {selectedModelDiagnostics?.exceedsWebMaskLimit ? (
                  <em>{selectedModelDiagnostics.maskBufferCount} buffers</em>
                ) : null}
                {selectedModelDiagnostics?.hiddenMaskSourceIds.length ? (
                  <em>hidden</em>
                ) : null}
              </summary>
              <div className="model-diagnostics-panel">
                {selectedModelDiagnostics ? (
                  <>
                    <div className="diagnostics-title">
                      {diagnosticsModel?.label ?? "Current model"}
                    </div>
                    <dl>
                      <div>
                        <dt>Clipped layers</dt>
                        <dd>{selectedModelDiagnostics.clippingDrawableCount}</dd>
                      </div>
                      <div>
                        <dt>Mask sources</dt>
                        <dd>{selectedModelDiagnostics.maskSourceCount}</dd>
                      </div>
                      <div>
                        <dt>Mask buffers</dt>
                        <dd>{selectedModelDiagnostics.maskBufferCount}</dd>
                      </div>
                      <div>
                        <dt>Mask size</dt>
                        <dd>
                          {selectedModelDiagnostics.clippingMaskBufferSize}px
                        </dd>
                      </div>
                      <div>
                        <dt>Blend</dt>
                        <dd>{selectedModelDiagnostics.usesBlendMode ? "on" : "off"}</dd>
                      </div>
                      <div>
                        <dt>Offscreen mask</dt>
                        <dd>
                          {selectedModelDiagnostics.usesOffscreenMasking
                            ? "on"
                            : "off"}
                        </dd>
                      </div>
                    </dl>
                    {selectedModelDiagnostics.hiddenMaskSourceIds.length > 0 ? (
                      <p title={selectedModelDiagnostics.hiddenMaskSourceIds.join(", ")}>
                        Hidden source:{" "}
                        {selectedModelDiagnostics.hiddenMaskSourceIds.length}
                      </p>
                    ) : null}
                  </>
                ) : (
                  <p>
                    {selectedModelDiagnosticStatus === "waiting"
                      ? "Waiting for model data."
                      : selectedModelDiagnosticStatus}
                  </p>
                )}
              </div>
            </details>
          </div>
        </header>

        <div className="viewer-frame">
          {loadedModels.length > 0 ? (
            <Live2DViewerDynamic
              width={width}
              height={height}
              fitToContainer
              selectedModelUrl={selectedUrl}
              models={loadedModels.map((model) => {
                const layerRenderSettings = getLayerRenderSettings(model.url);

                return {
                  modelUrl: model.url,
                  visible: visibleUrls.has(model.url),
                  interactive: model.url === selectedUrl,
                  blendMode: layerRenderSettings.blendMode,
                  clipToModelUrl: layerRenderSettings.clipToModelUrl || null,
                  viewTransformRef: getViewTransformRef(model.url),
                  onViewTransformChanged: (transform) =>
                    updateViewTransform(model.url, transform),
                  parameterValuesRef: getParameterValuesRef(model.url),
                  motionRequest: motionRequestByUrl[model.url] ?? null,
                  expressionRequest: expressionRequestByUrl[model.url] ?? null,
                  effectSettings: getEffectSettings(model.url),
                  parameterUpdateFps,
                  onParametersLoaded: (loadedParameters) =>
                    handleParametersLoaded(model.url, loadedParameters),
                  onModelDiagnostics: (diagnostics) =>
                    setModelDiagnosticsByUrl((current) => ({
                      ...current,
                      [model.url]: diagnostics,
                    })),
                  onParameterValuesChanged: (values) =>
                    setLiveParameterValuesByUrl((current) => ({
                      ...current,
                      [model.url]: values,
                    })),
                  onMotionsLoaded: (loadedMotions) =>
                    setMotionsByUrl((current) => ({
                      ...current,
                      [model.url]: loadedMotions,
                    })),
                  onExpressionsLoaded: (loadedExpressions) =>
                    setExpressionsByUrl((current) => ({
                      ...current,
                      [model.url]: loadedExpressions,
                    })),
                };
              })}
            />
          ) : (
            <p className="empty-copy">Load a model to show it on the stage.</p>
          )}
        </div>
      </div>

      <div
        aria-label="Resize inspector"
        aria-orientation="vertical"
        className="inspector-resizer"
        onPointerDown={startInspectorResize}
        role="separator"
      />

      <aside className="inspector">
        <div className="inspector-header">
          <div>
            <p className="eyebrow">Studio</p>
            <h2>{selectedModel?.label ?? "Studio"}</h2>
          </div>
          <details className="card-menu">
            <summary>Cards</summary>
            <div className="card-menu-panel">
              {(Object.keys(INSPECTOR_CARD_LABELS) as InspectorCardId[]).map(
                (card) => (
                  <label className="card-menu-option" key={card}>
                    <input
                      checked={visibleCards[card]}
                      onChange={() => toggleVisibleCard(card)}
                      type="checkbox"
                    />
                    <span>{INSPECTOR_CARD_LABELS[card]}</span>
                  </label>
                )
              )}
            </div>
          </details>
        </div>

        <div className="inspector-panel-tabs" role="tablist">
          {INSPECTOR_PANEL_OPTIONS.map((panel) => (
            <button
              aria-selected={activeInspectorPanel === panel.id}
              className={`inspector-panel-tab${
                activeInspectorPanel === panel.id ? " active" : ""
              }`}
              key={panel.id}
              onClick={() => setActiveInspectorPanel(panel.id)}
              role="tab"
              type="button"
            >
              {panel.label}
            </button>
          ))}
        </div>

        {activeInspectorPanel === "globalSync" ? (
        <section className="inspector-section">
          <div className="inspector-section-header">
            <span>Global Sync Settings</span>
          </div>

        {visibleCards.parameterSync ? (
          <div className="inspector-card">
            <button
              className="card-toggle"
              type="button"
              aria-expanded={expandedCards.parameterSync}
              onClick={() => toggleCard("parameterSync")}
            >
              <span>Parameter-Sync</span>
              <span className="card-meta">
                {parameterSyncRules.filter((rule) => rule.enabled).length}
              </span>
            </button>

            {expandedCards.parameterSync ? (
              <div className="card-body">
                <div className="section-heading">
                  <span>Rules</span>
                  <button
                    className="inline-action"
                    type="button"
                    onClick={addSyncRule}
                    disabled={options.length === 0}
                  >
                    Add
                  </button>
                </div>

                <div className="sync-rule-list">
                  {syncRuleSummaries.map((rule, index) => (
                    <div className="sync-panel" key={rule.id}>
                      <div className="section-heading">
                        <span>Rule {index + 1}</span>
                        <div className="sync-rule-actions">
                          <button
                            className={`switch-toggle${
                              rule.enabled ? " active" : ""
                            }`}
                            type="button"
                            role="switch"
                            aria-checked={rule.enabled}
                            onClick={() =>
                              updateSyncRule(rule.id, {
                                enabled: !rule.enabled,
                              })
                            }
                          >
                            <span className="switch-track" aria-hidden="true" />
                            <span className="switch-label">Sync</span>
                          </button>
                          <button
                            className="layer-button"
                            type="button"
                            title="Remove sync rule"
                            aria-label="Remove sync rule"
                            disabled={parameterSyncRules.length === 1}
                            onClick={() => removeSyncRule(rule.id)}
                          >
                            <span aria-hidden="true">&#215;</span>
                          </button>
                        </div>
                      </div>

                      <label className="search-field">
                        <span>Expression</span>
                        <textarea
                          value={rule.mappingsText}
                          onChange={(event) =>
                            updateSyncRule(rule.id, {
                              mappingsText: event.target.value,
                            })
                          }
                          placeholder={
                            "2head:Param*=4hairshadow:Param*\nParamMouthOpenY=ParamMouthOpen"
                          }
                          rows={3}
                        />
                      </label>

                      <p className="sync-summary">
                        {`${rule.activeMappingCount} active mappings. Use model:param=model:param for explicit routes.`}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {visibleCards.positionSync ? (
          <div className="inspector-card">
            <button
              className="card-toggle"
              type="button"
              aria-expanded={expandedCards.positionSync}
              onClick={() => toggleCard("positionSync")}
            >
              <span>Position-Sync</span>
              <span className="card-meta">
                {positionSync.enabled ? "on" : "off"}
              </span>
            </button>

            {expandedCards.positionSync ? (
              <div className="card-body">
                <div className="section-heading">
                  <span>Position</span>
                  <button
                    className={`switch-toggle${
                      positionSync.enabled ? " active" : ""
                    }`}
                    type="button"
                    role="switch"
                    aria-checked={positionSync.enabled}
                    onClick={() =>
                      setPositionSync((current) => ({
                        ...current,
                        enabled: !current.enabled,
                      }))
                    }
                  >
                    <span className="switch-track" aria-hidden="true" />
                    <span className="switch-label">Sync</span>
                  </button>
                </div>

                <label className="search-field">
                  <span>Expression</span>
                  <textarea
                    value={positionSync.expressionText}
                    onChange={(event) =>
                      setPositionSync((current) => ({
                        ...current,
                        expressionText: event.target.value,
                      }))
                    }
                    placeholder="A=B=C=D"
                    rows={2}
                  />
                </label>

                <p className="sync-summary">
                  {positionSync.expressionText.trim()
                    ? `${positionSyncGroups.length} position sync group${
                        positionSyncGroups.length === 1 ? "" : "s"
                      }. First model in each group drives the rest.`
                    : "Enter groups like A=B=C. The first model drives the rest."}
                </p>
              </div>
            ) : null}
          </div>
        ) : null}

        </section>
        ) : null}

        {activeInspectorPanel === "layer" ? (
        <section className="inspector-section">
          <div className="inspector-section-header">
            <span>Layer Settings</span>
          </div>

        {visibleCards.layer ? (
          <div className="inspector-card">
            <button
              className="card-toggle"
              type="button"
              aria-expanded={expandedCards.layer}
              onClick={() => toggleCard("layer")}
            >
              <span>Layer Mode</span>
              <span className="card-meta">
                {visibleUrls.has(selectedUrl) ? "visible" : "hidden"}
              </span>
            </button>

            {expandedCards.layer ? (
              <div className="card-body">
                <label className="search-field">
                  <span>Blend mode</span>
                  <select
                    value={selectedLayerRenderSettings.blendMode}
                    disabled={!loadedUrls.has(selectedUrl)}
                    onChange={(event) =>
                      updateLayerRenderSettings(selectedUrl, {
                        blendMode: event.target.value as Live2DBlendMode,
                      })
                    }
                  >
                    {BLEND_MODE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="search-field">
                  <span>Clip to</span>
                  <select
                    value={selectedLayerRenderSettings.clipToModelUrl}
                    disabled={
                      !loadedUrls.has(selectedUrl) || loadedModels.length < 2
                    }
                    onChange={(event) =>
                      updateLayerRenderSettings(selectedUrl, {
                        clipToModelUrl: event.target.value,
                      })
                    }
                  >
                    <option value="">None</option>
                    {loadedModels
                      .filter((model) => model.url !== selectedUrl)
                      .map((model) => (
                        <option key={model.url} value={model.url}>
                          {model.label}
                        </option>
                      ))}
                  </select>
                </label>
              </div>
            ) : null}
          </div>
        ) : null}

        {visibleCards.position ? (
          <div className="inspector-card">
            <button
              className="card-toggle"
              type="button"
              aria-expanded={expandedCards.position}
              onClick={() => toggleCard("position")}
            >
              <span>Position</span>
              <span className="card-meta">
                {selectedViewTransform.zoom.toFixed(2)}x
              </span>
            </button>

            {expandedCards.position ? (
              <div className="card-body">
                <div className="position-grid">
                  <label className="number-field">
                    <span>X</span>
                    <input
                      step={0.01}
                      type="number"
                      value={selectedViewTransform.panX}
                      onChange={(event) =>
                        updateSelectedViewTransform({
                          panX: Number(event.target.value),
                        })
                      }
                    />
                  </label>

                  <label className="number-field">
                    <span>Y</span>
                    <input
                      step={0.01}
                      type="number"
                      value={selectedViewTransform.panY}
                      onChange={(event) =>
                        updateSelectedViewTransform({
                          panY: Number(event.target.value),
                        })
                      }
                    />
                  </label>

                  <label className="number-field">
                    <span>Zoom</span>
                    <input
                      min={0.01}
                      step={0.01}
                      type="number"
                      value={selectedViewTransform.zoom}
                      onChange={(event) =>
                        updateSelectedViewTransform({
                          zoom: Number(event.target.value),
                        })
                      }
                    />
                  </label>
                </div>

                <button
                  className="ghost-button"
                  type="button"
                  onClick={resetSelectedViewTransform}
                >
                  Reset Position
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        </section>
        ) : null}

        {activeInspectorPanel === "modelControls" ? (
        <section className="inspector-section">
          <div className="inspector-section-header">
            <span>Model Controls</span>
          </div>

        {visibleCards.effects ? (
          <div className="inspector-card">
            <button
              className="card-toggle"
              type="button"
              aria-expanded={expandedCards.effects}
              onClick={() => toggleCard("effects")}
            >
              <span>Effects</span>
              <span className="card-meta">
                {
                  EFFECT_OPTIONS.filter(
                    (effect) => selectedEffectSettings[effect.key]
                  ).length
                }
                /{EFFECT_OPTIONS.length}
              </span>
            </button>

            {expandedCards.effects ? (
              <div className="card-body">
                <div className="effect-toggle-list">
                  {EFFECT_OPTIONS.map((effect) => {
                    const enabled = selectedEffectSettings[effect.key];

                    return (
                      <div className="effect-row" key={effect.key}>
                        <div>
                          <span className="effect-name">{effect.label}</span>
                          <span className="effect-description">
                            {effect.description}
                          </span>
                        </div>
                        <button
                          className={`switch-toggle${
                            enabled ? " active" : ""
                          }`}
                          type="button"
                          role="switch"
                          aria-checked={enabled}
                          onClick={() =>
                            updateEffectSettings(selectedUrl, {
                              [effect.key]: !enabled,
                            })
                          }
                        >
                          <span className="switch-track" aria-hidden="true" />
                          <span className="switch-label">
                            {enabled ? "On" : "Off"}
                          </span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {visibleCards.motions ? (
          <div className="inspector-card">
            <button
              className="card-toggle"
              type="button"
              aria-expanded={expandedCards.motions}
              onClick={() => toggleCard("motions")}
            >
              <span>Motions</span>
              <span className="card-meta">{motions.length}</span>
            </button>

            {expandedCards.motions ? (
              <div className="card-body animation-card-body">
                <div className="pill-list">
                  {motions.map((motion) => (
                    <button
                      className="pill-button"
                      key={`${motion.group}:${motion.index}`}
                      onClick={() => requestMotion(motion)}
                      type="button"
                    >
                      {motion.name}
                    </button>
                  ))}
                  {motions.length === 0 ? (
                    <p className="empty-copy compact">No motions found.</p>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {visibleCards.expressions ? (
          <div className="inspector-card">
            <button
              className="card-toggle"
              type="button"
              aria-expanded={expandedCards.expressions}
              onClick={() => toggleCard("expressions")}
            >
              <span>Expressions</span>
              <span className="card-meta">{expressions.length}</span>
            </button>

            {expandedCards.expressions ? (
              <div className="card-body animation-card-body">
                <div className="pill-list">
                  {expressions.map((expression) => (
                    <button
                      className="pill-button"
                      key={expression.index}
                      onClick={() => requestExpression(expression)}
                      type="button"
                    >
                      {expression.name}
                    </button>
                  ))}
                  {expressions.length === 0 ? (
                    <p className="empty-copy compact">No expressions found.</p>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        </section>
        ) : null}

        {activeInspectorPanel === "parameters" ? (
        <section className="inspector-section">
          <div className="inspector-section-header">
            <span>Parameters</span>
          </div>

        {visibleCards.parameters ? (
          <div
            className={`inspector-card${
              expandedCards.parameters ? " parameter-card controls-card" : ""
            }`}
          >
            <button
              className="card-toggle"
              type="button"
              aria-expanded={expandedCards.parameters}
              onClick={() => toggleCard("parameters")}
            >
              <span>Parameters</span>
              <span className="card-meta">{parameters.length}</span>
            </button>

            {expandedCards.parameters ? (
              <div className="card-body controls-card-body">
                <div className="parameter-tools">
                  <label className="search-field">
                    <span>Search</span>
                    <input
                      value={parameterFilter}
                      onChange={(event) =>
                        setParameterFilter(event.target.value)
                      }
                      placeholder="ParamAngle, Eye, Mouth..."
                      type="search"
                    />
                  </label>

                  <label className="search-field">
                    <span>Update rate</span>
                    <select
                      value={parameterUpdateFps}
                      onChange={(event) =>
                        setParameterUpdateFps(Number(event.target.value))
                      }
                    >
                      {PARAMETER_UPDATE_RATES.map((rate) => (
                        <option key={rate.value} value={rate.value}>
                          {rate.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <button
                  className="ghost-button"
                  type="button"
                  onClick={resetAllParameters}
                  disabled={parameters.length === 0}
                >
                  Reset Parameters
                </button>

                <div className="parameter-list" aria-label="Live2D parameters">
                  {filteredParameters.map((parameter) => (
                    <ParameterControl
                      key={parameter.id}
                      parameter={parameter}
                      liveValue={liveParameterValues[parameter.id]}
                      parameterValuesRef={selectedParameterValuesRef}
                      resetVersion={resetVersion}
                    />
                  ))}

                  {parameters.length === 0 ? (
                    <p className="empty-copy">
                      Parameters will appear here after the highlighted model
                      finishes loading.
                    </p>
                  ) : null}

                  {parameters.length > 0 && filteredParameters.length === 0 ? (
                    <p className="empty-copy">No parameters match this search.</p>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        </section>
        ) : null}
      </aside>
    </section>
  );
}
