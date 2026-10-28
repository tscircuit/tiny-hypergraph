const formatNumber = (value, digits = 3) =>
  typeof value === "number" && Number.isFinite(value)
    ? value.toFixed(digits)
    : "n/a"

const formatTime = (value) =>
  typeof value === "number" && Number.isFinite(value)
    ? `${(value / 1000).toFixed(3)}s`
    : "n/a"

const formatMemory = (byteCount) =>
  typeof byteCount === "number" && Number.isFinite(byteCount)
    ? `${(byteCount / (1024 * 1024)).toFixed(1)} MiB`
    : "n/a"

const parsePercent = (label) => {
  const match = String(label ?? "")
    .trim()
    .match(/^(-?\d+(?:\.\d+)?)%/)
  if (!match) return null
  const value = Number(match[1])
  return Number.isFinite(value) ? value : null
}

const formatSigned = (value, suffix = "") =>
  `${value > 0 ? "+" : ""}${value.toFixed(1)}${suffix}`

const formatPercentPointDelta = (baseValue, prValue) => {
  const basePercent = parsePercent(baseValue)
  const prPercent = parsePercent(prValue)
  if (basePercent === null || prPercent === null) return "n/a"
  return formatSigned(prPercent - basePercent, " pp")
}

const formatRelativeDelta = (baseValue, prValue) => {
  if (
    typeof baseValue !== "number" ||
    typeof prValue !== "number" ||
    !Number.isFinite(baseValue) ||
    !Number.isFinite(prValue) ||
    baseValue === 0
  ) {
    return "n/a"
  }
  return formatSigned(((prValue - baseValue) / baseValue) * 100, "%")
}

const formatMemoryDelta = (baseReport, prReport, baseValue, prValue) =>
  baseReport?.memoryMeasurement === prReport?.memoryMeasurement
    ? formatRelativeDelta(baseValue, prValue)
    : "n/a (measurement changed)"

const getDurationPercentile = (report, summaryKey, percentile) => {
  const summaryValue = report?.summary?.[summaryKey]
  if (typeof summaryValue === "number" && Number.isFinite(summaryValue)) {
    return summaryValue
  }

  const durations = (report?.samples ?? [])
    .map((sample) => sample.durationMs)
    .filter(
      (duration) => typeof duration === "number" && Number.isFinite(duration),
    )
    .sort((left, right) => left - right)
  if (durations.length === 0) return null
  const index = Math.min(
    durations.length - 1,
    Math.max(0, Math.ceil((percentile / 100) * durations.length) - 1),
  )
  return durations[index] ?? null
}

export const renderBenchmarkComparison = (baseReport, prReport) => {
  const baseSummary = baseReport?.summary
  const prSummary = prReport?.summary
  const solver = prReport?.solverVariant ?? baseReport?.solverVariant ?? "n/a"
  const baseP50DurationMs = getDurationPercentile(
    baseReport,
    "p50DurationMs",
    50,
  )
  const prP50DurationMs = getDurationPercentile(prReport, "p50DurationMs", 50)
  const baseP80DurationMs = getDurationPercentile(
    baseReport,
    "p80DurationMs",
    80,
  )
  const prP80DurationMs = getDurationPercentile(prReport, "p80DurationMs", 80)
  const baseP95DurationMs = getDurationPercentile(
    baseReport,
    "p95DurationMs",
    95,
  )
  const prP95DurationMs = getDurationPercentile(prReport, "p95DurationMs", 95)
  const rows = [
    "| Solver | Metric | Base | PR | Delta |",
    "| --- | --- | ---: | ---: | ---: |",
    `| ${solver} | Completion | ${baseSummary?.successRate ?? "n/a"} | ${prSummary?.successRate ?? "n/a"} | ${formatPercentPointDelta(baseSummary?.successRate, prSummary?.successRate)} |`,
    `| ${solver} | Route completion | ${baseSummary?.routeCompletionRate ?? "n/a"} | ${prSummary?.routeCompletionRate ?? "n/a"} | ${formatPercentPointDelta(baseSummary?.routeCompletionRate, prSummary?.routeCompletionRate)} |`,
    `| ${solver} | P50 time | ${formatTime(baseP50DurationMs)} | ${formatTime(prP50DurationMs)} | ${formatRelativeDelta(baseP50DurationMs, prP50DurationMs)} |`,
    `| ${solver} | P80 time | ${formatTime(baseP80DurationMs)} | ${formatTime(prP80DurationMs)} | ${formatRelativeDelta(baseP80DurationMs, prP80DurationMs)} |`,
    `| ${solver} | P95 time | ${formatTime(baseP95DurationMs)} | ${formatTime(prP95DurationMs)} | ${formatRelativeDelta(baseP95DurationMs, prP95DurationMs)} |`,
    `| ${solver} | Memory P50 | ${formatMemory(baseSummary?.p50RssBytes)} | ${formatMemory(prSummary?.p50RssBytes)} | ${formatMemoryDelta(baseReport, prReport, baseSummary?.p50RssBytes, prSummary?.p50RssBytes)} |`,
    `| ${solver} | Memory P80 | ${formatMemory(baseSummary?.p80RssBytes)} | ${formatMemory(prSummary?.p80RssBytes)} | ${formatMemoryDelta(baseReport, prReport, baseSummary?.p80RssBytes, prSummary?.p80RssBytes)} |`,
    `| ${solver} | Memory P90 | ${formatMemory(baseSummary?.p90RssBytes)} | ${formatMemory(prSummary?.p90RssBytes)} | ${formatMemoryDelta(baseReport, prReport, baseSummary?.p90RssBytes, prSummary?.p90RssBytes)} |`,
    `| ${solver} | Final cost | ${formatNumber(baseSummary?.avgFinalMaxRegionCost)} | ${formatNumber(prSummary?.avgFinalMaxRegionCost)} | ${formatRelativeDelta(baseSummary?.avgFinalMaxRegionCost, prSummary?.avgFinalMaxRegionCost)} |`,
    `| ${solver} | Avg hops | ${formatNumber(baseSummary?.avgRouteHops)} | ${formatNumber(prSummary?.avgRouteHops)} | ${formatRelativeDelta(baseSummary?.avgRouteHops, prSummary?.avgRouteHops)} |`,
  ]

  return rows.join("\n")
}
