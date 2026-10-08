import { expect, test } from "bun:test"
import { renderBenchmarkComparison } from "../scripts/benchmarking/render-pr-comparison.js"

test("PR comparison renders metrics as rows", () => {
  const makeReport = (overrides: Record<string, unknown>) => ({
    solverVariant: "core",
    memoryMeasurement: "isolated-sample-peak" as const,
    summary: {
      successRate: "100.0%",
      routeCompletionRate: "100.0%",
      avgFinalMaxRegionCost: 2,
      avgRouteHops: 5,
      p50DurationMs: 1_000,
      p80DurationMs: 1_500,
      p95DurationMs: 2_000,
      p50RssBytes: 100 * 1024 * 1024,
      p80RssBytes: 120 * 1024 * 1024,
      p90RssBytes: 140 * 1024 * 1024,
      ...overrides,
    },
  })

  const markdown = renderBenchmarkComparison(
    makeReport({}),
    makeReport({
      p50DurationMs: 900,
      p80DurationMs: 1_200,
      p95DurationMs: 1_800,
      p50RssBytes: 80 * 1024 * 1024,
      p80RssBytes: 96 * 1024 * 1024,
      p90RssBytes: 112 * 1024 * 1024,
    }),
  )

  expect(markdown).toContain("| Solver | Metric | Base | PR | Delta |")
  expect(markdown).toContain("| core | Completion | 100.0% | 100.0% | 0.0 pp |")
  expect(markdown).toContain(
    "| core | Route completion | 100.0% | 100.0% | 0.0 pp |",
  )
  expect(markdown).toContain("| core | P50 time | 1.000s | 0.900s | -10.0% |")
  expect(markdown).toContain("| core | P80 time | 1.500s | 1.200s | -20.0% |")
  expect(markdown).toContain(
    "| core | Memory P90 | 140.0 MiB | 112.0 MiB | -20.0% |",
  )

  const changedMeasurementMarkdown = renderBenchmarkComparison(
    { ...makeReport({}), memoryMeasurement: undefined },
    makeReport({}),
  )
  expect(changedMeasurementMarkdown).toContain(
    "| core | Memory P50 | 100.0 MiB | 100.0 MiB | n/a (measurement changed) |",
  )
})
