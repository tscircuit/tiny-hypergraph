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

export const renderBenchmarkComparison = (baseReport, prReport) => {
  const baseSummary = baseReport?.summary
  const prSummary = prReport?.summary
  const solver = prReport?.solverVariant ?? baseReport?.solverVariant ?? "n/a"
  const rows = [
    "| Solver | Metric | Base | PR | Delta |",
    "| --- | --- | ---: | ---: | ---: |",
    `| ${solver} | Completion | ${baseSummary?.successRate ?? "n/a"} | ${prSummary?.successRate ?? "n/a"} | ${formatPercentPointDelta(baseSummary?.successRate, prSummary?.successRate)} |`,
    `| ${solver} | Route completion | ${baseSummary?.routeCompletionRate ?? "n/a"} | ${prSummary?.routeCompletionRate ?? "n/a"} | ${formatPercentPointDelta(baseSummary?.routeCompletionRate, prSummary?.routeCompletionRate)} |`,
    `| ${solver} | P50 time | ${formatTime(baseSummary?.p50DurationMs)} | ${formatTime(prSummary?.p50DurationMs)} | ${formatRelativeDelta(baseSummary?.p50DurationMs, prSummary?.p50DurationMs)} |`,
    `| ${solver} | P95 time | ${formatTime(baseSummary?.p95DurationMs)} | ${formatTime(prSummary?.p95DurationMs)} | ${formatRelativeDelta(baseSummary?.p95DurationMs, prSummary?.p95DurationMs)} |`,
    `| ${solver} | Memory P50 | ${formatMemory(baseSummary?.p50RssBytes)} | ${formatMemory(prSummary?.p50RssBytes)} | ${formatRelativeDelta(baseSummary?.p50RssBytes, prSummary?.p50RssBytes)} |`,
    `| ${solver} | Memory P80 | ${formatMemory(baseSummary?.p80RssBytes)} | ${formatMemory(prSummary?.p80RssBytes)} | ${formatRelativeDelta(baseSummary?.p80RssBytes, prSummary?.p80RssBytes)} |`,
    `| ${solver} | Memory P90 | ${formatMemory(baseSummary?.p90RssBytes)} | ${formatMemory(prSummary?.p90RssBytes)} | ${formatRelativeDelta(baseSummary?.p90RssBytes, prSummary?.p90RssBytes)} |`,
    `| ${solver} | Final cost | ${formatNumber(baseSummary?.avgFinalMaxRegionCost)} | ${formatNumber(prSummary?.avgFinalMaxRegionCost)} | ${formatRelativeDelta(baseSummary?.avgFinalMaxRegionCost, prSummary?.avgFinalMaxRegionCost)} |`,
    `| ${solver} | Avg hops | ${formatNumber(baseSummary?.avgRouteHops)} | ${formatNumber(prSummary?.avgRouteHops)} | ${formatRelativeDelta(baseSummary?.avgRouteHops, prSummary?.avgRouteHops)} |`,
  ]

  return rows.join("\n")
}
