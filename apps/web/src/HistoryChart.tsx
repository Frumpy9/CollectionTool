import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent
} from "react";

export type HistoryChartRange = "30d" | "90d" | "1y" | "all";

export type HistoryChartPoint = {
  id: string;
  timestamp: string;
  valueCents: number;
  deltaCents?: number | null;
  detail?: string;
};

type HistoryChartProps = {
  ariaLabel: string;
  points: HistoryChartPoint[];
  range: HistoryChartRange;
  onRangeChange: (range: HistoryChartRange) => void;
  formatValue: (valueCents: number) => string;
};

type ChartCoordinate = {
  point: HistoryChartPoint;
  x: number;
  y: number;
};

const historyRanges: Array<{ value: HistoryChartRange; label: string; days: number | null }> = [
  { value: "30d", label: "30D", days: 30 },
  { value: "90d", label: "90D", days: 90 },
  { value: "1y", label: "1Y", days: 365 },
  { value: "all", label: "All", days: null }
];

export function HistoryChart({
  ariaLabel,
  points,
  range,
  onRangeChange,
  formatValue
}: HistoryChartProps) {
  const [activePointId, setActivePointId] = useState<string | null>(null);
  const [canvasWidth, setCanvasWidth] = useState(760);
  const canvasRef = useRef<HTMLDivElement>(null);
  const gradientId = `history-area-${useId().replaceAll(":", "")}`;
  const clipId = `history-clip-${useId().replaceAll(":", "")}`;
  const describedById = `history-description-${useId().replaceAll(":", "")}`;
  const orderedPoints = useMemo(() => orderHistoryPoints(points), [points]);
  const visiblePoints = useMemo(
    () => filterHistoryPointsByRange(orderedPoints, range),
    [orderedPoints, range]
  );
  const chartPoints = useMemo(() => sampleHistoryPoints(visiblePoints), [visiblePoints]);

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    const updateWidth = () => {
      const width = Math.round(canvas.getBoundingClientRect().width);
      if (width > 0) {
        setCanvasWidth(width);
      }
    };

    updateWidth();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateWidth);
      return () => window.removeEventListener("resize", updateWidth);
    }

    const observer = new ResizeObserver(updateWidth);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  if (visiblePoints.length === 0) {
    return null;
  }

  const isCompactChart = canvasWidth < 540;
  const chartWidth = Math.max(280, canvasWidth);
  const chartHeight = isCompactChart ? 270 : 320;
  const chartPadding = isCompactChart
    ? { top: 18, right: 14, bottom: 46, left: 58 }
    : { top: 22, right: 22, bottom: 52, left: 78 };
  const plotWidth = chartWidth - chartPadding.left - chartPadding.right;
  const plotHeight = chartHeight - chartPadding.top - chartPadding.bottom;
  const values = visiblePoints.map((point) => point.valueCents);
  const firstPoint = visiblePoints[0];
  const latestPoint = visiblePoints[visiblePoints.length - 1];
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const periodDelta = latestPoint.valueCents - firstPoint.valueCents;
  const periodPercent = firstPoint.valueCents
    ? (periodDelta / firstPoint.valueCents) * 100
    : null;
  const trend = periodDelta > 0 ? "up" : periodDelta < 0 ? "down" : "flat";
  const { domainMin, domainMax, ticks: yTicks } = buildCurrencyAxis(values);
  const valueRange = Math.max(1, domainMax - domainMin);
  const timestamps = chartPoints.map((point, index) => pointTimestamp(point, index));
  const firstTimestamp = timestamps[0] ?? 0;
  const lastTimestamp = timestamps[timestamps.length - 1] ?? firstTimestamp;
  const timestampRange = Math.max(0, lastTimestamp - firstTimestamp);
  const coordinates: ChartCoordinate[] = chartPoints.map((point, index) => {
    const timestamp = timestamps[index];
    const x =
      chartPoints.length === 1
        ? chartPadding.left + plotWidth / 2
        : timestampRange > 0
          ? chartPadding.left + ((timestamp - firstTimestamp) / timestampRange) * plotWidth
          : chartPadding.left + (index / (chartPoints.length - 1)) * plotWidth;
    const y =
      chartPadding.top +
      plotHeight -
      ((point.valueCents - domainMin) / valueRange) * plotHeight;

    return { point, x, y };
  });
  const linePath = smoothLinePath(coordinates);
  const areaPath =
    coordinates.length > 1
      ? `${linePath} L ${coordinates[coordinates.length - 1].x} ${
          chartPadding.top + plotHeight
        } L ${coordinates[0].x} ${chartPadding.top + plotHeight} Z`
      : "";
  const activeIndex = coordinates.findIndex(
    (coordinate) => coordinate.point.id === activePointId
  );
  const activeCoordinate = activeIndex >= 0 ? coordinates[activeIndex] : null;
  const xTicks = buildTimeTicks(
    firstTimestamp,
    lastTimestamp,
    visiblePoints.length,
    isCompactChart ? 3 : 4
  );
  const periodLabel = historyPeriodLabel(firstPoint.timestamp, latestPoint.timestamp);

  function inspectNearestPoint(event: PointerEvent<SVGSVGElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const pointerX = ((event.clientX - bounds.left) / bounds.width) * chartWidth;
    const nearest = coordinates.reduce((best, coordinate) =>
      Math.abs(coordinate.x - pointerX) < Math.abs(best.x - pointerX) ? coordinate : best
    );

    setActivePointId(nearest.point.id);
  }

  function handleKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End", "Escape"].includes(event.key)) {
      return;
    }

    event.preventDefault();

    if (event.key === "Escape") {
      setActivePointId(null);
      return;
    }

    const currentIndex = activePointId
      ? coordinates.findIndex((coordinate) => coordinate.point.id === activePointId)
      : coordinates.length - 1;
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? coordinates.length - 1
          : event.key === "ArrowLeft"
            ? Math.max(0, currentIndex - 1)
            : Math.min(coordinates.length - 1, currentIndex + 1);

    setActivePointId(coordinates[nextIndex].point.id);
  }

  return (
    <div className={`history-chart trend-${trend}`}>
      <div className="history-chart-toolbar">
        <div className="history-chart-period">
          <span>Timeline</span>
          <strong>{periodLabel}</strong>
        </div>
        <div aria-label="Chart date range" className="history-range-control" role="group">
          {historyRanges.map((option) => (
            <button
              aria-pressed={range === option.value}
              className={range === option.value ? "active" : ""}
              key={option.value}
              onClick={() => onRangeChange(option.value)}
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="history-chart-metrics">
        <div>
          <span>Latest</span>
          <strong>{formatValue(latestPoint.valueCents)}</strong>
        </div>
        <div>
          <span>Period change</span>
          <strong className={historyChangeClass(periodDelta)}>
            {formatSignedValue(periodDelta, formatValue)}
            {periodPercent === null ? "" : ` (${formatSignedPercent(periodPercent)})`}
          </strong>
        </div>
        <div>
          <span>Low</span>
          <strong>{formatValue(minValue)}</strong>
        </div>
        <div>
          <span>High</span>
          <strong>{formatValue(maxValue)}</strong>
        </div>
      </div>

      <div
        aria-describedby={describedById}
        aria-label={`${ariaLabel}. ${visiblePoints.length} points from ${formatChartDate(
          firstPoint.timestamp,
          true
        )} to ${formatChartDate(latestPoint.timestamp, true)}.`}
        className="history-chart-canvas"
        onBlur={() => setActivePointId(null)}
        onFocus={() => setActivePointId((current) => current ?? latestPoint.id)}
        onKeyDown={handleKeyboard}
        role="group"
        ref={canvasRef}
        tabIndex={0}
      >
        <svg
          aria-hidden="true"
          onPointerDown={inspectNearestPoint}
          onPointerLeave={() => setActivePointId(null)}
          onPointerMove={inspectNearestPoint}
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.26" />
              <stop offset="75%" stopColor="currentColor" stopOpacity="0.045" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
            <clipPath id={clipId}>
              <rect
                height={plotHeight + 12}
                width={plotWidth + 12}
                x={chartPadding.left - 6}
                y={chartPadding.top - 6}
              />
            </clipPath>
          </defs>

          {yTicks.map((tick) => {
            const y =
              chartPadding.top + plotHeight - ((tick - domainMin) / valueRange) * plotHeight;

            return (
              <g className="history-axis-tick" key={`y-${tick}`}>
                <line
                  x1={chartPadding.left}
                  x2={chartPadding.left + plotWidth}
                  y1={y}
                  y2={y}
                />
                <text textAnchor="end" x={chartPadding.left - 12} y={y + 4}>
                  {formatCompactCurrency(tick)}
                </text>
              </g>
            );
          })}

          {xTicks.map((tick, index) => {
            const x =
              xTicks.length === 1
                ? chartPadding.left + plotWidth / 2
                : chartPadding.left + (index / (xTicks.length - 1)) * plotWidth;

            return (
              <g className="history-axis-tick history-x-tick" key={`x-${tick}-${index}`}>
                <line
                  x1={x}
                  x2={x}
                  y1={chartPadding.top}
                  y2={chartPadding.top + plotHeight}
                />
                <text
                  textAnchor={index === 0 ? "start" : index === xTicks.length - 1 ? "end" : "middle"}
                  x={x}
                  y={chartHeight - 18}
                >
                  {formatAxisDate(tick, lastTimestamp - firstTimestamp)}
                </text>
              </g>
            );
          })}

          <g clipPath={`url(#${clipId})`}>
            {areaPath ? (
              <path className="history-chart-area" d={areaPath} fill={`url(#${gradientId})`} />
            ) : null}
            {coordinates.length > 1 ? <path className="history-chart-line" d={linePath} /> : null}
            {coordinates.length <= 36
              ? coordinates.map(({ point, x, y }) => (
                  <circle
                    className={`history-chart-point ${historyChangeClass(point.deltaCents ?? null)}`}
                    cx={x}
                    cy={y}
                    key={point.id}
                    r={point.id === activePointId ? 5.5 : 3.2}
                  />
                ))
              : null}
          </g>

          {activeCoordinate ? (
            <HistoryChartTooltip
              chartPadding={chartPadding}
              chartWidth={chartWidth}
              coordinate={activeCoordinate}
              formatValue={formatValue}
              plotBottom={chartPadding.top + plotHeight}
            />
          ) : null}
        </svg>

        <p aria-live="polite" className="sr-only" id={describedById}>
          {activeCoordinate
            ? `${formatValue(activeCoordinate.point.valueCents)} on ${formatChartDate(
                activeCoordinate.point.timestamp,
                true
              )}${activeCoordinate.point.detail ? `. ${activeCoordinate.point.detail}` : ""}`
            : "Focus the chart and use the left and right arrow keys to inspect saved values."}
        </p>
      </div>

      <div className="history-chart-caption">
        <span>
          {visiblePoints.length} saved point{visiblePoints.length === 1 ? "" : "s"}
          {visiblePoints.length !== points.length ? ` of ${points.length}` : ""}
        </span>
        <span>Hover, tap, or use arrow keys to inspect</span>
      </div>
    </div>
  );
}

function HistoryChartTooltip({
  chartPadding,
  chartWidth,
  coordinate,
  formatValue,
  plotBottom
}: {
  chartPadding: { top: number; right: number; bottom: number; left: number };
  chartWidth: number;
  coordinate: ChartCoordinate;
  formatValue: (valueCents: number) => string;
  plotBottom: number;
}) {
  const tooltipWidth = 196;
  const tooltipHeight = coordinate.point.detail ? 80 : 64;
  const x = clamp(
    coordinate.x - tooltipWidth / 2,
    chartPadding.left + 6,
    chartWidth - chartPadding.right - tooltipWidth - 6
  );
  const aboveY = coordinate.y - tooltipHeight - 16;
  const y = aboveY >= chartPadding.top ? aboveY : Math.min(plotBottom - tooltipHeight - 8, coordinate.y + 16);
  const detail = coordinate.point.detail ? truncateText(coordinate.point.detail, 32) : null;

  return (
    <g className="history-chart-inspector">
      <line
        className="history-chart-crosshair"
        x1={coordinate.x}
        x2={coordinate.x}
        y1={chartPadding.top}
        y2={plotBottom}
      />
      <circle className="history-chart-active-point" cx={coordinate.x} cy={coordinate.y} r="6" />
      <g className="history-chart-tooltip" transform={`translate(${x} ${y})`}>
        <rect height={tooltipHeight} rx="9" width={tooltipWidth} />
        <text className="history-tooltip-value" x="12" y="24">
          {formatValue(coordinate.point.valueCents)}
        </text>
        <text className="history-tooltip-date" x="12" y="44">
          {formatChartDate(coordinate.point.timestamp, true)}
        </text>
        {detail ? (
          <text className="history-tooltip-detail" x="12" y="64">
            {detail}
          </text>
        ) : null}
      </g>
    </g>
  );
}

function orderHistoryPoints(points: HistoryChartPoint[]) {
  return points
    .map((point, index) => ({ point, index, time: Date.parse(point.timestamp) }))
    .sort((left, right) => {
      if (!Number.isFinite(left.time) || !Number.isFinite(right.time)) {
        return left.index - right.index;
      }

      return left.time - right.time || left.index - right.index;
    })
    .map(({ point }) => point);
}

function filterHistoryPointsByRange(
  points: HistoryChartPoint[],
  range: HistoryChartRange
) {
  const days = historyRanges.find((option) => option.value === range)?.days ?? null;

  if (days === null || points.length < 2) {
    return points;
  }

  const latestTimestamp = [...points]
    .reverse()
    .map((point) => Date.parse(point.timestamp))
    .find(Number.isFinite);

  if (latestTimestamp === undefined) {
    return points;
  }

  const cutoff = latestTimestamp - days * 24 * 60 * 60 * 1000;
  const filtered = points.filter((point) => {
    const timestamp = Date.parse(point.timestamp);
    return !Number.isFinite(timestamp) || timestamp >= cutoff;
  });

  return filtered.length > 0 ? filtered : [points[points.length - 1]];
}

function buildCurrencyAxis(values: number[], targetTickCount = 5) {
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const rawRange = rawMax - rawMin;
  const padding = rawRange > 0 ? rawRange * 0.12 : Math.max(Math.abs(rawMax) * 0.08, 100);
  const paddedMin = Math.max(0, rawMin - padding);
  const paddedMax = rawMax + padding;
  const step = niceNumber(Math.max(1, (paddedMax - paddedMin) / (targetTickCount - 1)));
  const domainMin = Math.max(0, Math.floor(paddedMin / step) * step);
  const domainMax = Math.max(domainMin + step, Math.ceil(paddedMax / step) * step);
  const ticks: number[] = [];

  for (let tick = domainMin; tick <= domainMax + step / 2; tick += step) {
    ticks.push(Math.round(tick));
  }

  return { domainMin, domainMax, ticks };
}

function niceNumber(value: number) {
  const exponent = Math.floor(Math.log10(value));
  const fraction = value / 10 ** exponent;
  const niceFraction = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10;
  return niceFraction * 10 ** exponent;
}

function buildTimeTicks(
  firstTimestamp: number,
  lastTimestamp: number,
  pointCount: number,
  maxTickCount = 4
) {
  if (pointCount <= 1 || firstTimestamp === lastTimestamp) {
    return [firstTimestamp];
  }

  const count = Math.min(pointCount, maxTickCount);
  return Array.from({ length: count }, (_, index) =>
    Math.round(firstTimestamp + (index / (count - 1)) * (lastTimestamp - firstTimestamp))
  );
}

function smoothLinePath(coordinates: ChartCoordinate[]) {
  if (coordinates.length === 0) {
    return "";
  }

  return coordinates.slice(1).reduce((path, coordinate, index) => {
    const previous = coordinates[index];
    const middleX = previous.x + (coordinate.x - previous.x) / 2;
    return `${path} C ${middleX} ${previous.y}, ${middleX} ${coordinate.y}, ${coordinate.x} ${coordinate.y}`;
  }, `M ${coordinates[0].x} ${coordinates[0].y}`);
}

function sampleHistoryPoints(points: HistoryChartPoint[], threshold = 180) {
  if (points.length <= threshold) {
    return points;
  }

  const sampled: HistoryChartPoint[] = [points[0]];
  const bucketSize = (points.length - 2) / (threshold - 2);
  let previousSelectedIndex = 0;

  for (let bucket = 0; bucket < threshold - 2; bucket += 1) {
    const averageStart = Math.floor((bucket + 1) * bucketSize) + 1;
    const averageEnd = Math.min(Math.floor((bucket + 2) * bucketSize) + 1, points.length);
    const averageBucket = points.slice(averageStart, averageEnd);
    const averageX =
      averageBucket.reduce((total, point, index) => total + pointTimestamp(point, averageStart + index), 0) /
      Math.max(1, averageBucket.length);
    const averageY =
      averageBucket.reduce((total, point) => total + point.valueCents, 0) /
      Math.max(1, averageBucket.length);
    const rangeStart = Math.floor(bucket * bucketSize) + 1;
    const rangeEnd = Math.min(Math.floor((bucket + 1) * bucketSize) + 1, points.length - 1);
    const previousPoint = points[previousSelectedIndex];
    const previousX = pointTimestamp(previousPoint, previousSelectedIndex);
    let largestArea = -1;
    let selectedIndex = rangeStart;

    for (let index = rangeStart; index < rangeEnd; index += 1) {
      const point = points[index];
      const area = Math.abs(
        (previousX - averageX) * (point.valueCents - previousPoint.valueCents) -
          (previousX - pointTimestamp(point, index)) * (averageY - previousPoint.valueCents)
      );

      if (area > largestArea) {
        largestArea = area;
        selectedIndex = index;
      }
    }

    sampled.push(points[selectedIndex]);
    previousSelectedIndex = selectedIndex;
  }

  sampled.push(points[points.length - 1]);
  return sampled;
}

function pointTimestamp(point: HistoryChartPoint, fallbackIndex: number) {
  const timestamp = Date.parse(point.timestamp);
  return Number.isFinite(timestamp) ? timestamp : fallbackIndex;
}

function historyPeriodLabel(firstTimestamp: string, latestTimestamp: string) {
  const first = Date.parse(firstTimestamp);
  const latest = Date.parse(latestTimestamp);

  if (!Number.isFinite(first) || !Number.isFinite(latest)) {
    return "Saved refreshes";
  }

  const days = Math.max(0, Math.round((latest - first) / (24 * 60 * 60 * 1000)));

  if (days === 0) {
    return "Today";
  }

  if (days < 60) {
    return `${days} day${days === 1 ? "" : "s"}`;
  }

  if (days < 730) {
    const months = Math.max(1, Math.round(days / 30.4));
    return `${months} month${months === 1 ? "" : "s"}`;
  }

  const years = days / 365.25;
  return `${years.toFixed(years >= 10 ? 0 : 1)} years`;
}

function formatAxisDate(timestamp: number, spanMs: number) {
  const date = new Date(timestamp);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  if (spanMs < 2 * 24 * 60 * 60 * 1000) {
    return date.toLocaleString(undefined, { hour: "numeric", minute: "2-digit" });
  }

  if (spanMs < 370 * 24 * 60 * 60 * 1000) {
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  return date.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
}

function formatChartDate(value: string, includeTime = false) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return includeTime
    ? date.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit"
      })
    : date.toLocaleDateString();
}

function formatCompactCurrency(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: Math.abs(cents) >= 100_000 ? "compact" : "standard",
    maximumFractionDigits: Math.abs(cents) >= 100_000 ? 1 : 0
  }).format(cents / 100);
}

function formatSignedValue(valueCents: number, formatValue: (valueCents: number) => string) {
  if (valueCents === 0) {
    return formatValue(0);
  }

  return `${valueCents > 0 ? "+" : "−"}${formatValue(Math.abs(valueCents))}`;
}

function formatSignedPercent(percent: number) {
  if (Math.abs(percent) < 0.05) {
    return "0.0%";
  }

  return `${percent > 0 ? "+" : "−"}${Math.abs(percent).toFixed(1)}%`;
}

function historyChangeClass(value: number | null) {
  if (value === null || value === 0) {
    return "price-change-neutral";
  }

  return value > 0 ? "price-change-positive" : "price-change-negative";
}

function truncateText(value: string, maxLength: number) {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
