import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { parsePrBenchmarkCommand } from "../scripts/benchmarking/pr-benchmark-command.js"

test("PR benchmark commands always dispatch a paired same-machine comparison", () => {
  expect(parsePrBenchmarkCommand("/benchmark\n")).toEqual({ benchmarkArgs: [] })
  expect(
    parsePrBenchmarkCommand(
      '/benchmark --dataset srj18 --limit 4 --families "default+deep"',
    ),
  ).toEqual({
    benchmarkArgs: [
      "--dataset",
      "srj18",
      "--limit",
      "4",
      "--families",
      "default+deep",
    ],
  })
  expect(() => parsePrBenchmarkCommand("/benchmark-all")).toThrow(
    "Expected /benchmark",
  )
  expect(() => parsePrBenchmarkCommand('/benchmark --solver "core')).toThrow(
    "Unterminated quote",
  )

  const workflow = readFileSync(
    new URL("../.github/workflows/benchmark.yml", import.meta.url),
    "utf8",
  )
  expect(workflow).toContain("Checkout PR base")
  expect(workflow).toContain("Checkout PR head")
  expect(workflow).toContain("path: same-machine-base")
  expect(workflow).toContain("path: same-machine-pr")
  expect(workflow).toContain("Run same-machine comparison")
  expect(workflow).toContain(
    "github.event_name == 'issue_comment' && 120 || 60",
  )
  expect(workflow).toContain("const baseStatus = runRevision('base')")
  expect(workflow).toContain("const prStatus = runRevision('pr')")
  expect(workflow).toContain("baseSha = pr.data.base.sha")
  expect(workflow).toContain("report.summary?.p50RssBytes")
  expect(workflow).toContain("report.summary?.p80RssBytes")
  expect(workflow).toContain("report.summary?.p90RssBytes")
  expect(workflow).toContain("renderBenchmarkComparison")
  expect(workflow).toContain("runner.name")
  expect(workflow).toContain("Same Machine Benchmark Results")
  expect(workflow).not.toContain("Download main branch benchmark result")
  expect(workflow).not.toContain("cached main branch benchmark result")
})
