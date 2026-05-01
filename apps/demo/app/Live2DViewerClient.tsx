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
  const [parameters, setParameters] = useState<Live2DParameter[]>([]);
  const [liveParameterValues, setLiveParameterValues] = useState<
    Record<string, number>
  >({});
  const [motions, setMotions] = useState<Live2DMotionOption[]>([]);
  const [expressions, setExpressions] = useState<Live2DExpressionOption[]>([]);
  const [motionRequest, setMotionRequest] =
    useState<Live2DMotionRequest | null>(null);
  const [expressionRequest, setExpressionRequest] =
    useState<Live2DExpressionRequest | null>(null);
  const [parameterFilter, setParameterFilter] = useState("");
  const [parameterUpdateFps, setParameterUpdateFps] = useState(10);
  const [resetVersion, setResetVersion] = useState(0);
  const parameterValuesRef = useRef<Record<string, number>>({});
  const selectedModel =
    options.find((model) => model.url === selectedUrl) ?? options[0];
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
  const handleParametersLoaded = useCallback(
    (loadedParameters: Live2DParameter[]) => {
      setParameters(loadedParameters);
      setLiveParameterValues(
        Object.fromEntries(
          loadedParameters.map((parameter) => [parameter.id, parameter.value])
        )
      );
      parameterValuesRef.current = {};
      setParameterFilter("");
      setResetVersion((current) => current + 1);
    },
    []
  );
  const resetAllParameters = () => {
    parameterValuesRef.current = {};
    setResetVersion((current) => current + 1);
  };
  const requestMotion = (motion: Live2DMotionOption) => {
    setMotionRequest({
      group: motion.group,
      index: motion.index,
      nonce: Date.now(),
    });
  };
  const requestExpression = (expression: Live2DExpressionOption) => {
    setExpressionRequest({
      index: expression.index,
      nonce: Date.now(),
    });
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
            <span className="muted">{options.length}</span>
          </div>

          <div className="model-list" role="listbox" aria-label="Model list">
            {options.map((model) => {
              const isSelected = model.url === selectedUrl;

              return (
                <button
                  key={model.url}
                  className={`model-button${isSelected ? " selected" : ""}`}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => {
                    setSelectedUrl(model.url);
                    setParameters([]);
                    setLiveParameterValues({});
                    setMotions([]);
                    setExpressions([]);
                    setMotionRequest(null);
                    setExpressionRequest(null);
                    parameterValuesRef.current = {};
                  }}
                >
                  <span className="model-name">{model.label}</span>
                  <span className="model-source">
                    {model.source === "models" ? "Custom" : "SDK Sample"}
                  </span>
                </button>
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
            <p className="eyebrow">Selected Model</p>
            <h2>{selectedModel?.label ?? "No model found"}</h2>
          </div>
          <div className="model-path" title={selectedUrl}>
            {selectedUrl}
          </div>
        </header>

        <div className="viewer-frame">
          <Live2DViewerDynamic
            key={selectedUrl}
            modelUrl={selectedUrl}
            width={width}
            height={height}
            fitToContainer
            parameterValuesRef={parameterValuesRef}
            motionRequest={motionRequest}
            expressionRequest={expressionRequest}
            parameterUpdateFps={parameterUpdateFps}
            onParametersLoaded={handleParametersLoaded}
            onParameterValuesChanged={setLiveParameterValues}
            onMotionsLoaded={setMotions}
            onExpressionsLoaded={setExpressions}
          />
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
              parameterValuesRef={parameterValuesRef}
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
