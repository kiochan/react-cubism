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
  Live2DExpressionOption,
  Live2DExpressionRequest,
  Live2DMotionOption,
  Live2DMotionRequest,
  Live2DParameter,
  Live2DViewTransform,
} from "live2d-react";

// Dynamically import the viewer with SSR disabled because Live2DViewer requires
// browser APIs (WebGL, fetch) that are not available on the server.
const Live2DViewerDynamic = dynamic(
  () => import("live2d-react").then((m) => m.Live2DMultiViewer),
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

const BLEND_MODE_OPTIONS: Array<{ label: string; value: Live2DBlendMode }> = [
  { label: "Normal", value: "normal" },
  { label: "Multiply", value: "multiply" },
];

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
  const options = useMemo<ModelOption[]>(
    () =>
      models.length > 0
        ? models
        : [{ label: modelUrl, url: modelUrl, source: "models" }],
    [modelUrl, models]
  );
  const [selectedUrl, setSelectedUrl] = useState(modelUrl);
  const [loadedUrls, setLoadedUrls] = useState<Set<string>>(
    () => new Set([modelUrl])
  );
  const [visibleUrls, setVisibleUrls] = useState<Set<string>>(
    () => new Set([modelUrl])
  );
  const [layerOrder, setLayerOrder] = useState<string[]>(() =>
    options.map((model) => model.url)
  );
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
    sync: true,
    layer: true,
    controls: true,
  });
  const [resetVersion, setResetVersion] = useState(0);
  const parameterValuesRefs = useRef<
    Record<string, React.MutableRefObject<Record<string, number>>>
  >({});
  const viewTransformRefs = useRef<
    Record<string, React.MutableRefObject<Live2DViewTransform>>
  >({});
  const lastSyncedParametersRef = useRef<Record<string, SyncedParameters[]>>({});
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
  const motions = motionsByUrl[selectedUrl] ?? [];
  const expressions = expressionsByUrl[selectedUrl] ?? [];
  const modelsByUrl = useMemo(
    () => new Map(options.map((model) => [model.url, model])),
    [options]
  );
  const orderedOptions = layerOrder
    .map((url) => modelsByUrl.get(url))
    .filter((model): model is ModelOption => Boolean(model));
  const displayOptions = [...orderedOptions].reverse();
  const loadedModels = orderedOptions.filter((model) =>
    loadedUrls.has(model.url)
  );
  const displayLoadedModels = [...loadedModels].reverse();
  const visibleLoadedModels = loadedModels.filter((model) =>
    visibleUrls.has(model.url)
  );
  const controlModels = loadedModels.length > 0 ? loadedModels : orderedOptions;
  const modelCounts = options.reduce(
    (counts, model) => ({
      ...counts,
      [model.source]: counts[model.source] + 1,
    }),
    { models: 0, samples: 0 }
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
    const validUrls = new Set(options.map((model) => model.url));
    setLoadedUrls((current) => {
      const next = new Set(
        Array.from(current).filter((url) => validUrls.has(url))
      );
      if (next.size === 0 && options[0]) next.add(options[0].url);
      return next;
    });
    setVisibleUrls((current) => {
      const next = new Set(
        Array.from(current).filter((url) => validUrls.has(url))
      );
      if (next.size === 0 && options[0]) next.add(options[0].url);
      return next;
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
  const loadModel = (url: string, show = true) => {
    setLoadedUrls((current) => new Set(current).add(url));
    if (show) setVisibleUrls((current) => new Set(current).add(url));
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
    const urls = options.map((model) => model.url);
    setLoadedUrls(new Set(urls));
    setVisibleUrls(new Set(urls));
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
  const toggleCard = (card: keyof typeof expandedCards) => {
    setExpandedCards((current) => ({
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
    <section className="workspace">
      <aside className="sidebar">
        <div className="sidebar-header">
          <div>
            <p className="eyebrow">Cubism Viewer</p>
            <h1>Live2D Studio</h1>
          </div>
          <span className="status-dot" aria-label="Ready" />
        </div>

        <div className="sidebar-section">
          <div className="section-heading">
            <span>Models</span>
            <button
              className="inline-action"
              type="button"
              onClick={loadAllModels}
              disabled={options.length === 0}
            >
              Load all
            </button>
          </div>

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
              const layerRenderSettings = getLayerRenderSettings(model.url);
              const clipTargetOptions = loadedModels.filter(
                (loadedModel) => loadedModel.url !== model.url
              );

              return (
                <div
                  key={model.url}
                  className={`model-row${isSelected ? " selected" : ""}`}
                  role="option"
                  aria-selected={isSelected}
                >
                  <button
                    className="model-select-button"
                    type="button"
                    onClick={() => {
                      setSelectedUrl(model.url);
                      setParameterFilter("");
                    }}
                  >
                    <span className="model-name">{model.label}</span>
                    <span className="model-source">
                      {model.source === "models" ? "Custom" : "SDK Sample"}
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
                        onClick={() =>
                          isLoaded
                            ? unloadModel(model.url)
                            : loadModel(model.url)
                        }
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
                    </div>
                    <div className="layer-render-controls">
                      <label className="compact-select">
                        <span>Blend</span>
                        <select
                          value={layerRenderSettings.blendMode}
                          disabled={!isLoaded}
                          onChange={(event) =>
                            updateLayerRenderSettings(model.url, {
                              blendMode: event.target
                                .value as Live2DBlendMode,
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
                      <label className="compact-select">
                        <span>Clip</span>
                        <select
                          value={layerRenderSettings.clipToModelUrl}
                          disabled={!isLoaded || clipTargetOptions.length === 0}
                          onChange={(event) =>
                            updateLayerRenderSettings(model.url, {
                              clipToModelUrl: event.target.value,
                            })
                          }
                        >
                          <option value="">None</option>
                          {clipTargetOptions.map((targetModel) => (
                            <option
                              key={targetModel.url}
                              value={targetModel.url}
                            >
                              {targetModel.label}
                            </option>
                          ))}
                        </select>
                      </label>
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
        </div>

        <div className="sidebar-footer">
          <div className="stat-card">
            <span>Custom</span>
            <strong>{modelCounts.models}</strong>
          </div>
          <div className="stat-card">
            <span>Samples</span>
            <strong>{modelCounts.samples}</strong>
          </div>
        </div>
      </aside>

      <div className="stage">
        <header className="stage-toolbar">
          <div>
            <p className="eyebrow">Loaded Models</p>
            <h2>{selectedModel?.label ?? "No model found"}</h2>
          </div>
          <div className="model-path" title={selectedUrl}>
            {visibleLoadedModels.length}/{loadedModels.length} visible
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
                  parameterUpdateFps,
                  onParametersLoaded: (loadedParameters) =>
                    handleParametersLoaded(model.url, loadedParameters),
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

      <aside className="inspector">
        <div className="inspector-header">
          <div>
            <p className="eyebrow">Studio</p>
            <h2>{selectedModel?.label ?? "Controls"}</h2>
          </div>
        </div>

        <div className="inspector-card">
          <button
            className="card-toggle"
            type="button"
            aria-expanded={expandedCards.sync}
            onClick={() => toggleCard("sync")}
          >
            <span>Sync</span>
            <span className="card-meta">
              {parameterSyncRules.filter((rule) => rule.enabled).length +
                (positionSync.enabled ? 1 : 0)}
            </span>
          </button>

          {expandedCards.sync ? (
            <div className="card-body">
              <div className="section-heading">
                <span>Parameter</span>
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

        <div className="inspector-card">
          <button
            className="card-toggle"
            type="button"
            aria-expanded={expandedCards.layer}
            onClick={() => toggleCard("layer")}
          >
            <span>Layer</span>
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

        <div className="inspector-card parameter-card controls-card">
          <button
            className="card-toggle"
            type="button"
            aria-expanded={expandedCards.controls}
            onClick={() => toggleCard("controls")}
          >
            <span>Controls</span>
            <span className="card-meta">
              {selectedModel?.label ?? "model"}
            </span>
          </button>

          {expandedCards.controls ? (
            <div className="card-body controls-card-body">
              <label className="search-field">
                <span>Model</span>
                <select
                  value={selectedUrl}
                  onChange={(event) => {
                    setSelectedUrl(event.target.value);
                    setParameterFilter("");
                  }}
                >
                  {controlModels.map((model) => (
                    <option key={model.url} value={model.url}>
                      {model.label}
                    </option>
                  ))}
                </select>
              </label>

              <div className="section-heading">
                <span>Parameters</span>
                <span className="muted">{parameters.length}</span>
              </div>

              <div className="parameter-tools">
                <label className="search-field">
                  <span>Search</span>
                  <input
                    value={parameterFilter}
                    onChange={(event) => setParameterFilter(event.target.value)}
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
                    Parameters will appear here after the selected model
                    finishes loading.
                  </p>
                ) : null}

                {parameters.length > 0 && filteredParameters.length === 0 ? (
                  <p className="empty-copy">No parameters match this search.</p>
                ) : null}
              </div>

              <div className="section-heading">
                <span>Position</span>
                <span className="muted">
                  {selectedViewTransform.zoom.toFixed(2)}x
                </span>
              </div>

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

              <div className="animation-section">
                <div className="section-heading">
                  <span>Motions</span>
                  <span className="muted">{motions.length}</span>
                </div>
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

              <div className="animation-section">
                <div className="section-heading">
                  <span>Expressions</span>
                  <span className="muted">{expressions.length}</span>
                </div>
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
            </div>
          ) : null}
        </div>
      </aside>
    </section>
  );
}
