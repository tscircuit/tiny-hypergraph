import { expect, test } from "bun:test"
import { convertPortPointPathingSolverInputToSerializedHyperGraph } from "lib/compat/convertPortPointPathingSolverInputToSerializedHyperGraph"
import { loadSerializedHyperGraph } from "lib/compat/loadSerializedHyperGraph"
import { SelectiveReripTinyHyperGraphSolver } from "lib/selective-rerip-tiny-hyper-graph-solver"

test("route effort summary attributes every search iteration to a route", async () => {
  const input = await Bun.file(
    new URL("../fixtures/CM5IO_HyperGraph.json", import.meta.url),
  ).json()
  const { topology, problem } = loadSerializedHyperGraph(
    convertPortPointPathingSolverInputToSerializedHyperGraph(input),
  )
  const solver = new SelectiveReripTinyHyperGraphSolver(topology, problem)
  solver.solve()
  expect(solver.solved).toBe(true)

  const summary = solver.getRouteEffortSummary()
  const totalIterations = summary.reduce((sum, r) => sum + r.iterations, 0)

  expect(summary).toHaveLength(problem.routeCount)
  expect(summary.every((r) => r.attempts >= 1 && r.iterations >= 1)).toBe(true)
  expect(totalIterations).toBeLessThanOrEqual(solver.iterations)
  expect(totalIterations).toBeGreaterThan(solver.iterations * 0.9)
  expect(summary.reduce((sum, r) => sum + r.iterationShare, 0)).toBeCloseTo(1)
  expect(typeof summary[0]!.connectionId).toBe("string")
})
