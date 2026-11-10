import { expect, test } from "bun:test"
import { convertPortPointPathingSolverInputToSerializedHyperGraph } from "lib/compat/convertPortPointPathingSolverInputToSerializedHyperGraph"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"
import { PreparedPortPointRoutingSolver } from "lib/prepared/PreparedPortPointRoutingSolver"

test("prepared routing ranks routes by reroute effort", async () => {
  const input = await Bun.file(
    new URL("../fixtures/CM5IO_HyperGraph.json", import.meta.url),
  ).json()
  const { topology, problem } = loadSerializedHyperGraph(
    convertPortPointPathingSolverInputToSerializedHyperGraph(input),
  )
  const solver = new PreparedPortPointRoutingSolver(topology, problem)
  solver.solve()
  expect(solver.solved).toBe(true)

  const summary = solver.getRouteEffortSummary()
  const totalRerouteEffort = summary.reduce((s, r) => s + r.rerouteEffort, 0)
  const totalIterations = summary.reduce((s, r) => s + r.iterations, 0)

  expect(summary.every((r) => r.rerouteEffort >= r.attempts)).toBe(true)
  expect(totalRerouteEffort).toBeLessThan(totalIterations)
  expect(summary.reduce((s, r) => s + r.rerouteEffortShare, 0)).toBeCloseTo(1)
  for (let i = 1; i < summary.length; i++) {
    expect(summary[i - 1]!.rerouteEffort).toBeGreaterThanOrEqual(
      summary[i]!.rerouteEffort,
    )
  }
})
