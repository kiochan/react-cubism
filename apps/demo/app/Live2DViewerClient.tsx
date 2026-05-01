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
  Live2DExpressionOption,
  Live2DExpressionRequest,
  Live2DMotionOption,
  Live2DMotionRequest,
  Live2DParameter,
} from "live2d-react";

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

const PARAMETER_UPDATE_RATES = [
  { label: "Realtime", value: 0 },
  { label: "30 FPS", value: 30 },
  { label: "10 FPS", value: 10 },
  { label: "4 FPS", value: 4 },
  { label: "1 FPS", value: 1 },
];

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
    parameterValuesRef.current[parameter.id] = nextValue;
    setIsOverridden(true);
    setValue(nextValue);
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
          {parameter.id}
        </button>
        <output>
          {isOverridden ? "Override " : "Live "}
          {value.toFixed(2)}
        </output>
      </div>
      <input
        aria-label={parameter.id}
        max={parameter.maximumValue}
        min={parameter.minimumValue}
        onChange={(event) => updateValue(Number(event.target.value))}
        step={step}
        type="range"
        value={value}
      />
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
  const [resetVersion, setResetVersion] = useState(0);
  const parameterValuesRefs = useRef<
    Record<string, React.MutableRefObject<Record<string, number>>>
  >({});
  const selectedModel =
    options.find((model) => model.url === selectedUrl) ?? options[0];
  const selectedParameterValuesRef =
    parameterValuesRefs.current[selectedUrl] ??
    ({ current: {} } as React.MutableRefObject<Record<string, number>>);
  const parameters = parametersByUrl[selectedUrl] ?? [];
  const liveParameterValues = liveParameterValuesByUrl[selectedUrl] ?? {};
  const motions = motionsByUrl[selectedUrl] ?? [];
  const expressions = expressionsByUrl[selectedUrl] ?? [];
  const loadedModels = options.filter((model) => loadedUrls.has(model.url));
  const visibleLoadedModels = loadedModels.filter((model) =>
    visibleUrls.has(model.url)
  );
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
      parameter.id.toLowerCase().includes(query)
    );
  }, [parameterFilter, parameters]);

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
  }, [options, selectedUrl]);

  const getParameterValuesRef = (url: string) => {
    parameterValuesRefs.current[url] ??= { current: {} };
    return parameterValuesRefs.current[url];
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
            {options.map((model) => {
              const isSelected = model.url === selectedUrl;
              const isLoaded = loadedUrls.has(model.url);
              const isVisible = visibleUrls.has(model.url);

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
                    <button
                      className={`mini-toggle${isLoaded ? " active" : ""}`}
                      type="button"
                      onClick={() =>
                        isLoaded ? unloadModel(model.url) : loadModel(model.url)
                      }
                    >
                      加载
                    </button>
                    <button
                      className={`mini-toggle${isVisible ? " active" : ""}`}
                      type="button"
                      onClick={() => toggleModelVisibility(model.url)}
                    >
                      显示
                    </button>
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
          {loadedModels.map((model) => {
            const isVisible = visibleUrls.has(model.url);

            return (
              <div
                className={`viewer-layer${isVisible ? "" : " hidden"}`}
                key={model.url}
                aria-hidden={!isVisible}
              >
                <Live2DViewerDynamic
                  modelUrl={model.url}
                  width={width}
                  height={height}
                  fitToContainer
                  parameterValuesRef={getParameterValuesRef(model.url)}
                  motionRequest={motionRequestByUrl[model.url] ?? null}
                  expressionRequest={expressionRequestByUrl[model.url] ?? null}
                  parameterUpdateFps={parameterUpdateFps}
                  onParametersLoaded={(loadedParameters) =>
                    handleParametersLoaded(model.url, loadedParameters)
                  }
                  onParameterValuesChanged={(values) =>
                    setLiveParameterValuesByUrl((current) => ({
                      ...current,
                      [model.url]: values,
                    }))
                  }
                  onMotionsLoaded={(loadedMotions) =>
                    setMotionsByUrl((current) => ({
                      ...current,
                      [model.url]: loadedMotions,
                    }))
                  }
                  onExpressionsLoaded={(loadedExpressions) =>
                    setExpressionsByUrl((current) => ({
                      ...current,
                      [model.url]: loadedExpressions,
                    }))
                  }
                />
              </div>
            );
          })}
          {loadedModels.length === 0 ? (
            <p className="empty-copy">Load a model to show it on the stage.</p>
          ) : null}
        </div>
      </div>

      <aside className="inspector">
        <div className="inspector-header">
          <div>
            <p className="eyebrow">Interactive Controls</p>
            <h2>Parameters</h2>
          </div>
          <button
            className="ghost-button"
            type="button"
            onClick={resetAllParameters}
            disabled={parameters.length === 0}
          >
            Reset
          </button>
        </div>

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
              Parameters will appear here after the selected model finishes
              loading.
            </p>
          ) : null}

          {parameters.length > 0 && filteredParameters.length === 0 ? (
            <p className="empty-copy">No parameters match this search.</p>
          ) : null}
        </div>
      </aside>
    </section>
  );
}
