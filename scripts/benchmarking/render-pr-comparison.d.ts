export type BenchmarkComparisonReport = {
  solverVariant?: string
  summary?: {
    successRate?: string
    routeCompletionRate?: string
    avgFinalMaxRegionCost?: number
    avgRouteHops?: number
    p50DurationMs?: number
    p80DurationMs?: number
    p95DurationMs?: number
    p50RssBytes?: number
    p80RssBytes?: number
    p90RssBytes?: number
  }
  samples?: Array<{
    durationMs?: number
  }>
}

export function renderBenchmarkComparison(
  baseReport: BenchmarkComparisonReport | null,
  prReport: BenchmarkComparisonReport | null,
): string
